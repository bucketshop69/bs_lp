import TelegramBot from 'node-telegram-bot-api';
import { getPoolDetails, PoolDetails } from '../../services/raydiumService';

export async function handlePoolByIdCommand(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1);

    if (!args || args.length === 0) {
        await bot.sendMessage(chatId, '❌ Please provide a pool ID.\nUsage: /pool_by_id <pool_id>');
        return;
    }

    const poolId = args[0];

    try {
        const [poolDetails] = await getPoolDetails([poolId]);
        if (!poolDetails) {
            await bot.sendMessage(chatId, '❌ Pool not found. Please check the pool ID and try again.');
            return;
        }

        const message = formatPoolDetails(poolDetails);
        const keyboard = createPoolOptionsKeyboard(poolDetails.id);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Error in /pool_by_id command:', error);
        await bot.sendMessage(chatId, '❌ Error fetching pool details. Please try again later.');
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