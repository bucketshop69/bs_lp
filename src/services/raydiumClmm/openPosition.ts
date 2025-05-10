import { ApiV3PoolInfoConcentratedItem, TickUtils, PoolUtils, ClmmKeys, CLMM_PROGRAM_ID, DEVNET_PROGRAM_ID, Raydium } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import { getUserKeypair } from '../getUserWallet';
import { isValidClmm } from './raydiumUtil';
import { initSdk } from './raydiumUtil';



interface CreatePositionParams {
    poolId: string;
    inputAmount: number;
    startPrice?: number;
    endPrice: number;
    slippage?: number;
    computeBudgetUnits?: number;
    computeBudgetMicroLamports?: number;
    userId?: string;
}

export const createPosition = async ({
    poolId,
    inputAmount,
    startPrice,
    endPrice,
    slippage = 5,
    computeBudgetUnits = 600000,
    computeBudgetMicroLamports = 100000,
    userId
}: CreatePositionParams) => {
    if (!userId) throw new Error('userId is required')
    const raydium = await initSdk({ owner: await getUserKeypair(userId) })
    if (!raydium) return
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

    const rpcData = await raydium.clmm.getRpcClmmPoolInfo({ poolId: poolInfo.id })
    poolInfo.price = rpcData.currentPrice
    const currentPrice = poolInfo.price;


    const [priceStart, priceEnd] = [startPrice ?? currentPrice, endPrice]

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
    const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
        poolInfo,
        slippage,
        inputA: true,
        tickUpper: Math.max(lowerTick, upperTick),
        tickLower: Math.min(lowerTick, upperTick),
        amount: new BN(new Decimal(inputAmount || '0').mul(10 ** poolInfo.mintA.decimals).toFixed(0)),
        add: true,
        amountHasFee: true,
        epochInfo: epochInfo,
    })
    console.log(res);

    const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
        poolInfo,
        poolKeys,
        tickUpper: Math.max(lowerTick, upperTick),
        tickLower: Math.min(lowerTick, upperTick),
        base: 'MintA',
        ownerInfo: {
            useSOLBalance: true,
        },
        baseAmount: new BN(new Decimal(inputAmount || '0').
            mul(10 ** poolInfo.mintA.decimals).toFixed(0)),
        otherAmountMax: res.amountSlippageB.amount,
        nft2022: true,
        computeBudgetConfig: {
            units: computeBudgetUnits,
            microLamports: computeBudgetMicroLamports,
        },
    })

    try {
        const { txId } = await execute({ sendAndConfirm: true })
        console.log('clmm position opened:', { txId, nft: extInfo.nftMint.toBase58() })
        return { txId, nft: extInfo.nftMint.toBase58() }
    } catch (error) {
        console.error('Transaction failed:', error)
        if (error instanceof Error) {
            console.error('Simulation logs:', error.message)
        }
        throw error
    }
}

// Example usage:
// (async () => {
//     try {
//         const result = await createPosition({
//             poolId: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv',
//             inputAmount: 0.005,
//             endPrice: 170
//         })
//         console.log(result)
//     } catch (error) {
//         console.log(error)
//     }
// })