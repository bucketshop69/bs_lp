import { initSdk, isValidClmm } from "./raydiumUtil"
import { getUserKeypair } from "../getUserWallet"
import { ApiV3PoolInfoConcentratedItem } from "@raydium-io/raydium-sdk-v2"
import { ClmmKeys } from "@raydium-io/raydium-sdk-v2"
import BN from "bn.js"

interface RemoveLiquidityParams {
    poolId: string;
    userId: string;
    closePosition?: boolean;
}

interface RemoveLiquidityResult {
    txId: string;
}

export async function removeLiquidity({
    poolId,
    userId,
    closePosition = true
}: RemoveLiquidityParams): Promise<RemoveLiquidityResult> {
    try {
        const raydium = await initSdk({ owner: await getUserKeypair(userId) })
        if (!raydium) throw new Error('Failed to initialize Raydium SDK')

        let poolInfo: ApiV3PoolInfoConcentratedItem
        let poolKeys: ClmmKeys | undefined

        if (raydium.cluster === 'mainnet') {
            const data = await raydium.api.fetchPoolById({ ids: poolId })
            poolInfo = data[0] as ApiV3PoolInfoConcentratedItem
            if (!isValidClmm(poolInfo.programId)) throw new Error('target pool is not CLMM pool')
        } else {
            const data = await raydium.clmm.getPoolInfoFromRpc(poolId)
            poolInfo = data.poolInfo
            poolKeys = data.poolKeys
        }

        const allPosition = await raydium.clmm.getOwnerPositionInfo({ programId: poolInfo.programId })
        if (!allPosition.length) throw new Error('user do not have any positions')

        const position = allPosition.find((p) => p.poolId.toBase58() === poolInfo.id)
        if (!position) throw new Error(`user do not have position in pool: ${poolInfo.id}`)

        const { execute } = await raydium.clmm.decreaseLiquidity({
            poolInfo,
            poolKeys,
            ownerPosition: position,
            ownerInfo: {
                useSOLBalance: true,
                closePosition,
            },
            liquidity: position.liquidity,
            amountMinA: new BN(0),
            amountMinB: new BN(0),
            computeBudgetConfig: {
                units: 1000000,
                microLamports: 100000,
            },
        })

        const { txId } = await execute({ sendAndConfirm: true })
        return { txId }



    } catch (error) {
        console.error('Error removing liquidity:', error)
        throw error
    }
}

// (async () => {
//     const result = await removeLiquidity({
//         poolId: '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj',
//         userId: '7883754831'
//     })
//     console.log(`https://solscan.io/tx/${result.txId}`)
// })()