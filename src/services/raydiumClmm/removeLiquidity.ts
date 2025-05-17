import { initSdk, isValidClmm } from "./raydiumUtil"
import { getUserKeypair } from "../getUserWallet"
import { ApiV3PoolInfoConcentratedItem, ClmmKeys, PositionUtils } from "@raydium-io/raydium-sdk-v2"
import BN from "bn.js"

interface RemoveLiquidityParams {
    poolId: string;
    userId: string;
    closePosition?: boolean;
    positionNftMint?: string;
    slippage?: number;
}

interface RemoveLiquidityResult {
    txId: string;
}

export async function removeLiquidity({
    poolId,
    userId,
    closePosition = true,
    positionNftMint,
    slippage = 0.5
}: RemoveLiquidityParams): Promise<RemoveLiquidityResult> {
    try {
        if (!poolId) throw new Error('Pool ID is required')
        if (!userId) throw new Error('User ID is required')

        console.log(`Starting liquidity removal for user: ${userId}, pool: ${poolId}`)

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

        // Check SOL balance
        const solBalance = await raydium.connection.getBalance(userKeypair.publicKey)
        const solBalanceInSol = solBalance / 10 ** 9
        if (solBalanceInSol < 0.001) {
            throw new Error(`Insufficient SOL balance. Required: ~0.001 SOL, Available: ${solBalanceInSol.toFixed(6)} SOL`)
        }
        console.log(`SOL balance check passed: ${solBalanceInSol.toFixed(6)} SOL available`)

        console.log(`Fetching positions for user...`)
        const allPositions = await raydium.clmm.getOwnerPositionInfo({ programId: poolInfo.programId })
        if (!allPositions.length) throw new Error('You have no positions in any pool')

        // Filter positions for the specific pool
        const poolPositions = allPositions.filter((p) => p.poolId.toBase58() === poolInfo.id)
        if (poolPositions.length === 0) throw new Error(`You don't have any positions in pool: ${poolInfo.id} (${poolInfo.mintA.symbol}/${poolInfo.mintB.symbol})`)

        console.log(`Found ${poolPositions.length} position(s) in pool ${poolInfo.id}`)

        // If NFT mint is specified, find that specific position
        let position = positionNftMint
            ? poolPositions.find(p => p.nftMint.toBase58() === positionNftMint)
            : poolPositions[0] // Default to first position if not specified

        if (!position) {
            if (positionNftMint) {
                throw new Error(`Position with NFT mint ${positionNftMint} not found in pool ${poolInfo.id}`)
            } else {
                throw new Error(`Cannot find a valid position in pool ${poolInfo.id}`)
            }
        }

        console.log(`Selected position: ${position.nftMint.toBase58()}`)

        // Check if position has liquidity
        if (position.liquidity.isZero()) {
            console.log(`Position has zero liquidity - cannot remove liquidity`)
            throw new Error("Position has zero liquidity - nothing to remove")
        }

        console.log(`Preparing to remove ${position.liquidity.toString()} liquidity units with ${slippage}% slippage`)

        try {
            // Get epoch info for calculations
            const epochInfo = await raydium.fetchEpochInfo();

            // Calculate minimum amounts with slippage
            const { amountA, amountB } = PositionUtils.getAmountsFromLiquidity({
                poolInfo,
                ownerPosition: position,
                liquidity: position.liquidity,
                slippage,
                add: false,
                epochInfo,
            });

            // Calculate minimum amounts with slippage (our own calculation as a fallback)
            // Apply slippage by reducing the expected amount by slippage %
            const slippageFactor = 1 - (slippage / 100);
            const amountMinA = new BN(amountA.amount.muln(Math.floor(slippageFactor * 1000)).divn(1000));
            const amountMinB = new BN(amountB.amount.muln(Math.floor(slippageFactor * 1000)).divn(1000));

            console.log(`Estimated token amounts:
            - ${poolInfo.mintA.symbol}: ${amountA.amount.toString()} (min: ${amountMinA.toString()})
            - ${poolInfo.mintB.symbol}: ${amountB.amount.toString()} (min: ${amountMinB.toString()})
            `);

            console.log(`Preparing transaction...`)

            const { execute } = await raydium.clmm.decreaseLiquidity({
                poolInfo,
                poolKeys,
                ownerPosition: position,
                ownerInfo: {
                    useSOLBalance: true,
                    closePosition
                },
                liquidity: position.liquidity,
                amountMinA: amountMinA,
                amountMinB: amountMinB,
                computeBudgetConfig: {
                    units: 300000,
                    microLamports: 25000,
                },
                txVersion: 0
            })

            console.log(`Transaction prepared, executing...`)
            const { txId } = await execute({ sendAndConfirm: true })
            console.log(`Liquidity removed successfully, txId: ${txId}`)

            return { txId }
        } catch (error) {
            console.error('Error removing liquidity:', error)

            // Detailed error logging
            let errorDetail = '';

            if (typeof error === 'object' && error !== null) {
                const err = error as any;
                // Try to safely stringify the error object
                let errorString = '';
                try {
                    // Only include non-circular parts of the error
                    const safeObj: Record<string, any> = {};
                    Object.keys(err).forEach(key => {
                        if (typeof err[key] !== 'function' && key !== 'stack') {
                            safeObj[key] = err[key];
                        }
                    });
                    errorString = JSON.stringify(safeObj, null, 2);
                } catch (e) {
                    errorString = 'Error object could not be stringified';
                }

                console.error('Detailed error:', errorString);
                errorDetail += `\nDetailed error: ${errorString}`;

                if (err.logs && Array.isArray(err.logs)) {
                    console.error('Transaction logs:', err.logs);
                    errorDetail += '\nTransaction logs: ' + err.logs.join('\n');
                }

                if (err.txId) {
                    console.error('Failed transaction ID:', err.txId);
                    errorDetail += `\nFailed transaction ID: ${err.txId}`;
                }
            }

            if (error instanceof Error) {
                const errorMsg = error.message;

                if (errorMsg.includes("InstructionError: [ 2, { Custom: 1 } ]")) {
                    throw new Error(
                        `Transaction failed: Solana "Custom: 1" error\n` +
                        `This is a generic Solana error that can have several causes:\n` +
                        `1. Position constraints are not met\n` +
                        `2. Pool state has changed since transaction preparation\n` +
                        `3. Insufficient funds or liquidity\n` +
                        `4. Protocol-specific constraints preventing the removal\n` +
                        `Try reducing the compute units, decreasing slippage, or contact support if the issue persists.${errorDetail}`
                    );
                }

                if (errorMsg.includes("Blockhash")) {
                    throw new Error(`Transaction failed: Blockhash expired - please try again${errorDetail}`);
                }

                if (errorMsg.includes("insufficient funds")) {
                    throw new Error(`Transaction failed: Insufficient funds for fees${errorDetail}`);
                }

                if (errorMsg.includes("SlippageToleranceExceeded")) {
                    throw new Error(`Transaction failed: Price moved beyond slippage tolerance. Try increasing the slippage value.${errorDetail}`);
                }
            }

            // For any other errors
            throw new Error(`Failed to remove liquidity: ${error instanceof Error ? error.message : String(error)}${errorDetail}`);
        }
    } catch (error) {
        console.error('Error in removeLiquidity:', error)
        throw error
    }
}