import { ApiV3PoolInfoConcentratedItem, TickUtils, PoolUtils, ClmmKeys, CLMM_PROGRAM_ID, DEVNET_PROGRAM_ID, Raydium } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import { getUserKeypair } from '../getUserWallet';
import { isValidClmm } from './raydiumUtil';
import { initSdk } from './raydiumUtil';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { PublicKey, Transaction, sendAndConfirmTransaction, Connection } from '@solana/web3.js';

interface CreatePositionParams {
    poolId: string;
    inputAmount: number;
    startPrice?: number;
    endPrice: number;
    slippage?: number;
    computeBudgetUnits?: number;
    computeBudgetMicroLamports?: number;
    userId?: string;
    selectedTokenMint?: string;
}

export const createPosition = async ({
    poolId,
    inputAmount,
    startPrice,
    endPrice,
    slippage = 5,
    computeBudgetUnits = 600000,
    computeBudgetMicroLamports = 100000,
    userId,
    selectedTokenMint
}: CreatePositionParams) => {
    if (!userId) throw new Error('userId is required')
    console.log(`Starting position creation for user: ${userId}, pool: ${poolId}`)

    const userKeypair = await getUserKeypair(userId)
    console.log(`User wallet address: ${userKeypair.publicKey.toString()}`)

    const raydium = await initSdk({ owner: userKeypair })
    if (!raydium) return

    console.log(`SDK initialized on ${raydium.cluster}`)

    let poolInfo: ApiV3PoolInfoConcentratedItem
    let poolKeys: ClmmKeys | undefined

    if (raydium.cluster === 'mainnet') {
        console.log(`Fetching mainnet pool info for poolId: ${poolId}`)
        const data = await raydium.api.fetchPoolById({ ids: poolId })
        poolInfo = data[0] as ApiV3PoolInfoConcentratedItem
        if (!isValidClmm(poolInfo.programId)) throw new Error('target pool is not CLMM pool')
    } else {
        console.log(`Fetching devnet pool info for poolId: ${poolId}`)
        const data = await raydium.clmm.getPoolInfoFromRpc(poolId)
        poolInfo = data.poolInfo
        poolKeys = data.poolKeys
    }

    console.log(`Pool tokens: ${poolInfo.mintA.symbol}/${poolInfo.mintB.symbol}`)
    console.log(`Pool token addresses: ${poolInfo.mintA.address} / ${poolInfo.mintB.address}`)

    // Check for token accounts using connection directly
    console.log(`Checking token accounts for user...`);

    // Function to check and create token account if needed
    async function ensureTokenAccount(mintAddress: string, tokenSymbol: string): Promise<boolean> {
        try {
            // Skip for WSOL/SOL as it's the native token
            if (tokenSymbol === 'WSOL' || tokenSymbol === 'SOL') {
                console.log(`Skipping token account check for ${tokenSymbol} as it's the native token`);
                return true;
            }

            if (!raydium) {
                console.error("Raydium SDK not initialized");
                return false;
            }

            const mintPublicKey = new PublicKey(mintAddress);
            const ata = await getAssociatedTokenAddress(
                mintPublicKey,
                userKeypair.publicKey
            );
            console.log(`Looking for ${tokenSymbol} account at: ${ata.toString()}`);

            const accountInfo = await raydium.connection.getAccountInfo(ata);

            if (accountInfo) {
                console.log(`${tokenSymbol} account found at ${ata.toString()}`);
                return true;
            } else {
                console.log(`${tokenSymbol} account not found. Creating it now...`);

                // Create the ATA
                const transaction = new Transaction().add(
                    createAssociatedTokenAccountInstruction(
                        userKeypair.publicKey, // payer
                        ata, // associatedToken
                        userKeypair.publicKey, // owner
                        mintPublicKey // mint
                    )
                );

                const signature = await sendAndConfirmTransaction(
                    raydium.connection,
                    transaction,
                    [userKeypair]
                );

                console.log(`Created ${tokenSymbol} account. Signature: ${signature}`);
                return true;
            }
        } catch (error) {
            console.error(`Error handling ${tokenSymbol} account:`, error);
            return false;
        }
    }

    // Ensure token accounts exist for both tokens in the pool
    const tokenACreated = await ensureTokenAccount(poolInfo.mintA.address, poolInfo.mintA.symbol);
    const tokenBCreated = await ensureTokenAccount(poolInfo.mintB.address, poolInfo.mintB.symbol);

    if (!tokenACreated || !tokenBCreated) {
        console.error("Failed to ensure token accounts exist. Position creation may fail.");
    } else {
        console.log("All required token accounts are ready.");
    }

    const rpcData = await raydium.clmm.getRpcClmmPoolInfo({ poolId: poolInfo.id })
    poolInfo.price = rpcData.currentPrice
    const currentPrice = poolInfo.price;

    // Explicitly prioritize SOL if it's in the pool
    let isTokenASOL = poolInfo.mintA.symbol === 'WSOL' || poolInfo.mintA.symbol === 'SOL';
    let isTokenBSOL = poolInfo.mintB.symbol === 'WSOL' || poolInfo.mintB.symbol === 'SOL';

    // Log pool tokens for debugging
    console.log(`Pool contains tokens: ${poolInfo.mintA.symbol} and ${poolInfo.mintB.symbol}`);
    console.log(`Is Token A SOL: ${isTokenASOL}, Is Token B SOL: ${isTokenBSOL}`);

    // If selectedTokenMint is specified, use that, otherwise prioritize SOL
    let useTokenA = true; // Default to using token A

    if (selectedTokenMint) {
        // User explicitly selected a token
        useTokenA = selectedTokenMint === poolInfo.mintA.address;
        console.log(`User selected token: ${selectedTokenMint}`);
    } else {
        // User didn't select a token, prioritize SOL
        if (isTokenBSOL && !isTokenASOL) {
            useTokenA = false; // Use token B (SOL) as base
            console.log(`Prioritizing SOL as base token (Token B)`);
        } else if (isTokenASOL && !isTokenBSOL) {
            useTokenA = true;  // Use token A (SOL) as base
            console.log(`Prioritizing SOL as base token (Token A)`);
        } else {
            // Either both tokens are SOL (unlikely) or neither is
            console.log(`Neither token is SOL or both are SOL-related. Defaulting to Token A`);
        }
    }

    const tokenToUse = useTokenA ? poolInfo.mintA : poolInfo.mintB;
    const base = useTokenA ? 'MintA' : 'MintB';

    console.log(`FINAL SELECTION: Using ${base} as base token: ${tokenToUse.symbol} (${tokenToUse.address})`);

    const [priceStart, priceEnd] = [startPrice ?? currentPrice, endPrice]
    console.log(`Price range: ${priceStart} - ${priceEnd}`);

    const { tick: lowerTick } = TickUtils.getPriceAndTick({
        poolInfo,
        price: new Decimal(priceStart),
        baseIn: true,
    })

    const { tick: upperTick } = TickUtils.getPriceAndTick({
        poolInfo,
        price: new Decimal(priceEnd),
        baseIn: true,
    })

    const epochInfo = await raydium.fetchEpochInfo()

    const inputTokenDecimals = tokenToUse.decimals;
    const inputA = useTokenA;

    const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
        poolInfo,
        slippage,
        inputA,
        tickUpper: Math.max(lowerTick, upperTick),
        tickLower: Math.min(lowerTick, upperTick),
        amount: new BN(new Decimal(inputAmount || '0').mul(10 ** inputTokenDecimals).toFixed(0)),
        add: true,
        amountHasFee: true,
        epochInfo: epochInfo,
    })
    console.log(`Liquidity calculation result:`, res);

    const baseAmount = new BN(new Decimal(inputAmount || '0').mul(10 ** inputTokenDecimals).toFixed(0));
    const otherAmountMax = inputA ? res.amountSlippageB.amount : res.amountSlippageA.amount;

    console.log(`Opening position with params:`, {
        poolId: poolInfo.id,
        base,
        baseAmount: baseAmount.toString(),
        otherAmountMax: otherAmountMax.toString(),
        tickLower: Math.min(lowerTick, upperTick),
        tickUpper: Math.max(lowerTick, upperTick),
    });

    try {
        console.log(`Preparing transaction...`);
        console.log(`Owner info:`, {
            address: userKeypair.publicKey.toString(),
            useSOLBalance: true,
        });

        const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
            poolInfo,
            poolKeys,
            tickUpper: Math.max(lowerTick, upperTick),
            tickLower: Math.min(lowerTick, upperTick),
            base,
            ownerInfo: {
                useSOLBalance: true,
            },
            baseAmount,
            otherAmountMax,
            nft2022: true,
            computeBudgetConfig: {
                units: computeBudgetUnits,
                microLamports: computeBudgetMicroLamports,
            },
        })

        console.log(`Transaction prepared, executing...`);
        const { txId } = await execute({ sendAndConfirm: true })
        console.log('clmm position opened:', { txId, nft: extInfo.nftMint.toBase58() })
        return { txId, nft: extInfo.nftMint.toBase58() }
    } catch (error) {
        console.error('Transaction failed:', error)
        if (error instanceof Error) {
            console.error('Simulation logs:', error.message)

            // Additional debug for token account error
            if (error.message.includes("cannot found target token accounts")) {
                console.error('TOKEN ACCOUNT ERROR: User is missing required token accounts')
                console.error('This typically happens when the user has not created a token account for one of the tokens in the pool')
                console.error(`Required token accounts: ${poolInfo.mintA.symbol} (${poolInfo.mintA.address}), ${poolInfo.mintB.symbol} (${poolInfo.mintB.address})`)
                console.error('Suggestion: Create token accounts for both tokens before opening a position')
            }
        }
        throw error
    }
}

// Example usage:
// (async () => {
//     try {
//         // Initialize SDK to find pool info and token mints
//         const userKeypair = await getUserKeypair("805213006");
//         const raydium = await initSdk({ owner: userKeypair });
//         if (!raydium) return;

//         const poolId = '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv';

//         // Get pool info to find SOL mint address
//         let poolInfo;
//         if (raydium.cluster === 'mainnet') {
//             const data = await raydium.api.fetchPoolById({ ids: poolId });
//             poolInfo = data[0];
//         } else {
//             const data = await raydium.clmm.getPoolInfoFromRpc(poolId);
//             poolInfo = data.poolInfo;
//         }

//         // Find SOL mint address in pool
//         let solMintAddress: string | undefined = undefined;
//         if (poolInfo.mintA.symbol === 'WSOL' || poolInfo.mintA.symbol === 'SOL') {
//             solMintAddress = poolInfo.mintA.address;
//             console.log(`Found SOL as Token A: ${solMintAddress}`);
//         } else if (poolInfo.mintB.symbol === 'WSOL' || poolInfo.mintB.symbol === 'SOL') {
//             solMintAddress = poolInfo.mintB.address;
//             console.log(`Found SOL as Token B: ${solMintAddress}`);
//         }

//         // Create position with explicit SOL selection
//         const result = await createPosition({
//             poolId: poolId,
//             inputAmount: 0.005,
//             endPrice: 175,
//             userId: "805213006",
//             selectedTokenMint: solMintAddress // Explicitly select SOL
//         });

//         console.log(result);
//     } catch (error) {
//         console.log(error);
//     }
// })()