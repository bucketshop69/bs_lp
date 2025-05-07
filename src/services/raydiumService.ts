import axios from 'axios';

interface TokenInfo {
    chainId: number;
    address: string;
    programId: string;
    logoURI: string;
    symbol: string;
    name: string;
    decimals: number;
    tags: string[];
    extensions: Record<string, any>;
}

interface RewardInfo {
    mint: TokenInfo;
    perSecond: string;
    startTime: string;
    endTime: string;
}

interface TimeFrameStats {
    volume: number;
    volumeQuote: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    priceMin: number;
    priceMax: number;
    rewardApr: number[];
}

interface PoolConfig {
    id: string;
    index: number;
    protocolFeeRate: number;
    tradeFeeRate: number;
    tickSpacing: number;
    fundFeeRate: number;
    defaultRange: number;
    defaultRangePoint: number[];
}

export interface PoolDetails {
    type: string;
    programId: string;
    id: string;
    mintA: TokenInfo;
    mintB: TokenInfo;
    rewardDefaultPoolInfos: string;
    rewardDefaultInfos: RewardInfo[];
    price: number;
    mintAmountA: number;
    mintAmountB: number;
    feeRate: number;
    openTime: string;
    tvl: number;
    day: TimeFrameStats;
    week: TimeFrameStats;
    month: TimeFrameStats;
    pooltype: string[];
    farmUpcomingCount: number;
    farmOngoingCount: number;
    farmFinishedCount: number;
    config: PoolConfig;
    burnPercent: number;
    launchMigratePool: boolean;
}

interface PoolListResponse {
    count: number;
    data: PoolDetails[];
    hasNextPage: boolean;
}

interface TokenInfoResponse {
    [mintAddress: string]: TokenInfo;
}

export async function getPoolList(
    page: number = 1,
    pageSize: number = 25,
    sortField: string = 'default',
    sortType: 'asc' | 'desc' = 'desc'
): Promise<PoolListResponse> {
    try {
        const url = `https://api-v3.raydium.io/pools/info/list`;
        const response = await axios.get(url, {
            params: {
                poolType: 'concentrated',
                poolSortField: sortField,
                sortType,
                pageSize,
                page
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching pool list:', error);
        throw new Error('Failed to fetch Raydium pool list');
    }
}

export async function getPoolDetails(poolIds: string[]): Promise<PoolDetails[]> {
    try {
        const url = `https://api-v3.raydium.io/pools/info/ids`;
        const response = await axios.get(url, {
            params: {
                ids: poolIds.join(',')
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching pool details:', error);
        throw new Error('Failed to fetch Raydium pool details');
    }
}

export async function searchPoolsByMint(
    mint1: string,
    mint2?: string,
    page: number = 1,
    pageSize: number = 10,
    sortField: string = 'default',
    sortType: 'asc' | 'desc' = 'desc'
): Promise<PoolListResponse> {
    try {
        const url = `https://api-v3.raydium.io/pools/info/mint`;
        const response = await axios.get(url, {
            params: {
                mint1,
                mint2: mint2 || '',
                poolType: 'concentrated',
                poolSortField: sortField,
                sortType,
                pageSize,
                page
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error searching pools by mint:', error);
        throw new Error('Failed to search Raydium pools by mint');
    }
}

export async function getTokenInfoByMints(mints: string[]): Promise<TokenInfoResponse> {
    try {
        const url = `https://api-v3.raydium.io/mint/ids`;
        const response = await axios.get(url, {
            params: {
                mints: mints.join(',')
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching token info:', error);
        throw new Error('Failed to fetch token information');
    }
}



