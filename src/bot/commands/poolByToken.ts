import TelegramBot from 'node-telegram-bot-api';
import { searchPoolsByMint, getPoolDetails, PoolDetails, PoolListResponse } from '../../services/raydiumService';

export async function handlePoolByTokenCommand(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1);

    if (!args || args.length === 0) {
        await bot.sendMessage(chatId, '❌ Please provide a token address.\nUsage: /pool_by_token <token_address>');
        return;
    }

    const tokenAddress = args[0];

    try {
        const response = await searchPoolsByMint(tokenAddress);
        if (!response.data || response.data.length === 0) {
            await bot.sendMessage(chatId, '❌ No pools found for this token. Please check the token address and try again.');
            return;
        }

        // Get detailed information for each pool
        const poolIds = response.data.map((pool: { id: string }) => pool.id);
        const poolDetails = await getPoolDetails(poolIds);

        // Filter out null values and display each pool's details
        const validPools = poolDetails.filter((pool): pool is PoolDetails => pool !== null);

        if (validPools.length === 0) {
            await bot.sendMessage(chatId, '❌ No valid pool details found. Please try again later.');
            return;
        }

        for (const pool of validPools) {
            const message = formatPoolDetails(pool);
            const keyboard = createPoolOptionsKeyboard(pool.id);

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    } catch (error) {
        console.error('Error in /pool_by_token command:', error);
        await bot.sendMessage(chatId, '❌ Error fetching pool data. Please try again later.');
    }
}

function formatPoolDetails(pool: PoolDetails): string {
    return `🔍 *${pool.mintA.symbol}/${pool.mintB.symbol} Pool Details*\n\n` +
        `TVL: $${formatNumber(pool.tvl)}\n` +
        `24h Volume: $${formatNumber(pool.day.volume)}\n` +
        `24h Fees: $${formatNumber(pool.day.volumeFee)}\n` +
        `APR: ${pool.day.apr.toFixed(2)}%\n` +
        `Fee Rate: ${(pool.feeRate * 100).toFixed(2)}%\n` +
        `Current Price: $${pool.price.toFixed(4)}`;
}

function createPoolOptionsKeyboard(poolId: string): TelegramBot.InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                { text: 'Single-Sided LP', callback_data: `lp_single_${poolId}` },
                { text: 'Dual-Sided LP', callback_data: `lp_dual_${poolId}` }
            ]
        ]
    };
}

function formatNumber(num: number): string {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
} 