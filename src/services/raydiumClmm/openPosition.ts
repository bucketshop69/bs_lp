import { ApiV3PoolInfoConcentratedItem, TickUtils, PoolUtils, ClmmKeys, CLMM_PROGRAM_ID, DEVNET_PROGRAM_ID, Raydium } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import { getUserKeypair } from '../getUserWallet';
import { isValidClmm } from './raydiumUtil';
import { initSdk } from './raydiumUtil';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
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
    // Input validation
    if (!userId) throw new Error('userId is required')
    if (!poolId) throw new Error('poolId is required')
    if (inputAmount <= 0) throw new Error('inputAmount must be greater than 0')
    if (endPrice <= 0) throw new Error('endPrice must be greater than 0')

    console.log(`Starting position creation for user: ${userId}, pool: ${poolId}`)

    const userKeypair = await getUserKeypair(userId)
    console.log(`User wallet address: ${userKeypair.publicKey.toString()}`)

    const raydium = await initSdk({ owner: userKeypair })
    if (!raydium) throw new Error('Failed to initialize Raydium SDK')

    console.log(`SDK initialized on ${raydium.cluster}`)

    let poolInfo: ApiV3PoolInfoConcentratedItem
    let poolKeys: ClmmKeys | undefined

    if (raydium.cluster === 'mainnet') {
        console.log(`Fetching mainnet pool info for poolId: ${poolId}`)
        const data = await raydium.api.fetchPoolById({ ids: poolId })
        if (!data || data.length === 0) throw new Error(`Pool with ID ${poolId} not found`)
        poolInfo = data[0] as ApiV3PoolInfoConcentratedItem
        if (!isValidClmm(poolInfo.programId)) throw new Error('Target pool is not a CLMM pool')
    } else {
        console.log(`Fetching devnet pool info for poolId: ${poolId}`)
        const data = await raydium.clmm.getPoolInfoFromRpc(poolId)
        poolInfo = data.poolInfo
        poolKeys = data.poolKeys
    }

    console.log(`Pool tokens: ${poolInfo.mintA.symbol}/${poolInfo.mintB.symbol}`)
    console.log(`Pool token addresses: ${poolInfo.mintA.address} / ${poolInfo.mintB.address}`)

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

    // Abort if token accounts couldn't be created
    if (!tokenACreated || !tokenBCreated) {
        throw new Error("Failed to ensure token accounts exist. Cannot proceed with position creation.");
    }

    console.log("All required token accounts are ready.");

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

    // Check user balance for selected token
    await checkUserBalance(raydium, userKeypair.publicKey, tokenToUse, inputAmount);

    // Handle start price and validate price range
    let priceStart = startPrice ?? currentPrice;
    if (priceStart === endPrice) {
        throw new Error('Start price and end price cannot be the same');
    }

    console.log(`Price range: ${priceStart} - ${endPrice}`);

    // Calculate lower and upper ticks from prices
    const { tick: tickAtStartPrice } = TickUtils.getPriceAndTick({
        poolInfo,
        price: new Decimal(priceStart),
        baseIn: true,
    });

    const { tick: tickAtEndPrice } = TickUtils.getPriceAndTick({
        poolInfo,
        price: new Decimal(endPrice),
        baseIn: true,
    });

    // Sort ticks properly
    const lowerTick = Math.min(tickAtStartPrice, tickAtEndPrice);
    const upperTick = Math.max(tickAtStartPrice, tickAtEndPrice);

    const epochInfo = await raydium.fetchEpochInfo();

    const inputTokenDecimals = tokenToUse.decimals;
    const inputA = useTokenA;

    // Never use 0 as fallback for input amount - we've already validated it's > 0
    const inputAmountBN = new BN(new Decimal(inputAmount).mul(10 ** inputTokenDecimals).toFixed(0));

    const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
        poolInfo,
        slippage,
        inputA,
        tickUpper: upperTick,
        tickLower: lowerTick,
        amount: inputAmountBN,
        add: true,
        amountHasFee: true,
        epochInfo: epochInfo,
    });
    console.log(`Liquidity calculation result:`, res);

    const baseAmount = inputAmountBN;
    const otherAmountMax = inputA ? res.amountSlippageB.amount : res.amountSlippageA.amount;

    console.log(`Opening position with params:`, {
        poolId: poolInfo.id,
        base,
        baseAmount: baseAmount.toString(),
        otherAmountMax: otherAmountMax.toString(),
        tickLower: lowerTick,
        tickUpper: upperTick,
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
            tickUpper: upperTick,
            tickLower: lowerTick,
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

            // Enhanced error handling for common issues
            if (error.message.includes("cannot found target token accounts")) {
                throw new Error(
                    `Missing token accounts: User needs token accounts for ${poolInfo.mintA.symbol} (${poolInfo.mintA.address}) and ${poolInfo.mintB.symbol} (${poolInfo.mintB.address})`
                );
            }

            if (error.message.includes("insufficient funds")) {
                throw new Error(
                    `Insufficient funds: User does not have enough ${tokenToUse.symbol} or SOL for transaction fees`
                );
            }
        }
        throw error
    }
}

// Helper function to check if user has sufficient balance
async function checkUserBalance(
    raydium: Raydium,
    userPubkey: PublicKey,
    token: { address: string, symbol: string, decimals: number },
    requiredAmount: number
): Promise<void> {
    try {
        // For SOL/WSOL, check native SOL balance
        if (token.symbol === 'WSOL' || token.symbol === 'SOL') {
            const solBalance = await raydium.connection.getBalance(userPubkey);
            const solBalanceInSol = solBalance / 10 ** 9; // Convert lamports to SOL

            // Increase the buffer for transaction fees - CLMM operations are complex
            // Raydium CLMM transactions require more SOL than standard transactions
            const solFeeBuffer = 0.003; // Increased from 0.001 to 0.003 SOL
            const minimumSolRequired = requiredAmount + solFeeBuffer;

            if (solBalanceInSol < minimumSolRequired) {
                const additionalNeeded = minimumSolRequired - solBalanceInSol;
                throw new Error(
                    `Insufficient SOL balance. Need ${minimumSolRequired.toFixed(6)} SOL (${requiredAmount.toFixed(6)} for position + ${solFeeBuffer} for fees), ` +
                    `but only have ${solBalanceInSol.toFixed(6)} SOL. ` +
                    `Please add at least ${additionalNeeded.toFixed(6)} more SOL to continue.`
                );
            }

            console.log(`SOL balance check passed: ${solBalanceInSol} SOL available for transaction requiring ~${minimumSolRequired} SOL`);
            return;
        }

        // For other tokens, check token account balance
        const tokenMint = new PublicKey(token.address);
        const tokenAccount = await getAssociatedTokenAddress(tokenMint, userPubkey);

        try {
            const accountInfo = await getAccount(raydium.connection, tokenAccount);
            const tokenBalance = Number(accountInfo.amount) / 10 ** token.decimals;

            if (tokenBalance < requiredAmount) {
                throw new Error(
                    `Insufficient ${token.symbol} balance. Required: ${requiredAmount}, Available: ${tokenBalance}. ` +
                    `Please add more ${token.symbol} to continue.`
                );
            }

            console.log(`${token.symbol} balance check passed: ${tokenBalance} available`);
        } catch (e) {
            throw new Error(`Failed to get ${token.symbol} balance: Token account may not exist`);
        }
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to check balance: ${String(error)}`);
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