import { initSdk } from "./raydiumUtil";
import { getUserKeypair } from "../getUserWallet";
import {
    ApiV3PoolInfoConcentratedItem,
    CLMM_PROGRAM_ID,
} from '@raydium-io/raydium-sdk-v2';

export const harvestPositionRewards = async (nftMint: string, userId: string) => {
    const raydium = await initSdk({ owner: await getUserKeypair(userId) });
    if (!raydium) return;

    // Get all positions for the owner
    const allPositions = await raydium.clmm.getOwnerPositionInfo({ programId: CLMM_PROGRAM_ID });

    // Find the specific position using nftMint
    const targetPosition = allPositions.find(p => p.nftMint.toBase58() === nftMint);
    if (!targetPosition) {
        throw new Error(`Position with NFT mint ${nftMint} not found`);
    }

    if (targetPosition.liquidity.isZero()) {
        throw new Error(`Position with NFT mint ${nftMint} has zero liquidity`);
    }

    // Get pool info for the position
    const poolInfo = await raydium.api.fetchPoolById({
        ids: targetPosition.poolId.toBase58(),
    }) as ApiV3PoolInfoConcentratedItem[];

    if (!poolInfo.length) {
        throw new Error(`Pool info not found for position ${nftMint}`);
    }

    // Prepare positions object
    const positions = {
        [targetPosition.poolId.toBase58()]: [targetPosition]
    };

    // Prepare pool info object
    const poolInfoMap = {
        [poolInfo[0].id]: poolInfo[0]
    };


    // // Harvest rewards for the specific position
    const { execute } = await raydium.clmm.harvestAllRewards({
        allPoolInfo: poolInfoMap,
        allPositions: positions,
        ownerInfo: {
            useSOLBalance: true,
        },
        programId: CLMM_PROGRAM_ID,
        computeBudgetConfig: {
            units: 1000000,
            microLamports: 100000,
        },
    });

    const { txIds } = await execute({
        sequentially: true,
        sendAndConfirm: true
    });
    console.log('Harvested rewards for position:', { nftMint, txIds });
    return txIds;
};

