import TelegramBot from 'node-telegram-bot-api';
import { getPoolList, getPoolDetails, PoolDetails, PoolListResponse } from '../../services/raydiumService';

interface PoolsListState {
    userId: string;
    chatId: number;
    currentPage: number;
    totalPages: number;
    pools: PoolDetails[];
    lastMessageId?: number;
    lastUpdate: number;
}

// Store user states for pagination
const userStates = new Map<string, PoolsListState>();
const POOLS_PER_PAGE = 5;
const poolsPageState = new Map<number, number>();

// Helper function to show loading state
async function showLoadingState(bot: TelegramBot, chatId: number): Promise<number> {
    const loadingMessage = await bot.sendMessage(chatId, '⏳ <b>Loading pools data...</b>', {
        parse_mode: 'HTML'
    });
    return loadingMessage.message_id;
}

export async function handlePoolsListCommand(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();

    if (!userId) {
        await bot.sendMessage(chatId, '❌ Error: Could not identify user.');
        return;
    }

    try {
        // Show loading state
        const loadingMessageId = await showLoadingState(bot, chatId);
        poolsPageState.set(chatId, 1);

        // Fetch all pools with timeout protection
        const allPools = await Promise.race([
            getPoolList(1, 25), // Get more pools at once
            new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), 15000)
            )
        ]) as PoolListResponse;

        // Delete loading message
        await bot.deleteMessage(chatId, loadingMessageId);

        if (!allPools.data || !Array.isArray(allPools.data) || allPools.data.length === 0) {
            await bot.sendMessage(chatId,
                '❌ <b>No Pools Data Available</b>\n\n' +
                'Unable to fetch pool data at the moment.\n' +
                'This might be due to:\n' +
                '• API service maintenance\n' +
                '• Network connectivity issues\n\n' +
                'Please try again in a few minutes.',
                { parse_mode: 'HTML' }
            );
            return;
        }

        // Sort pools by volume 
        const sortedPools = allPools.data.sort((a, b) =>
            b.day.volume - a.day.volume
        );

        // Calculate total pages
        const totalPages = Math.ceil(sortedPools.length / POOLS_PER_PAGE);

        // Store state for this user
        const state: PoolsListState = {
            userId,
            chatId,
            currentPage: 1,
            totalPages,
            pools: sortedPools,
            lastUpdate: Date.now()
        };
        userStates.set(userId, state);

        // Format message and create keyboard
        const message = formatPoolsMessage(sortedPools, 1, totalPages);
        const keyboard = createPoolsKeyboard(sortedPools, 1, totalPages);

        const sentMessage = await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });

        // Update state with message ID
        state.lastMessageId = sentMessage.message_id;
        userStates.set(userId, state);

    } catch (error) {
        console.error('Error in /pools_list command:', error);

        // Enhanced error message based on error type
        let errorMessage = '❌ <b>Error Fetching Pool Data</b>\n\n';

        if (error instanceof Error) {
            if (error.message === 'Request timeout') {
                errorMessage += 'Request timed out. The server is taking too long to respond.\n';
            } else {
                errorMessage += `Error: ${error.message}\n`;
            }
        }

        errorMessage += '\nPlease try again in a few moments.';

        await bot.sendMessage(chatId, errorMessage, { parse_mode: 'HTML' });
    }
}

function formatPoolsMessage(pools: PoolDetails[], currentPage: number, totalPages: number): string {
    let message = `📊 <b>Raydium CLMM Pools</b>\n\n`;

    // Get current page of pools
    const startIdx = (currentPage - 1) * POOLS_PER_PAGE;
    const endIdx = Math.min(startIdx + POOLS_PER_PAGE, pools.length);
    const pageItems = pools.slice(startIdx, endIdx);

    pageItems.forEach((pool, index) => {
        const poolNumber = startIdx + index + 1;
        message += `${poolNumber}. <b>${pool.mintA.symbol}/${pool.mintB.symbol}</b>\n`;
        message += `   Volume: $${formatNumber(pool.day.volume)}\n`;
        message += `   Fees: $${formatNumber(pool.day.volumeFee)}\n`;
        message += `   APR: ${pool.day.apr.toFixed(2)}%\n`;
        message += `   TVL: $${formatNumber(pool.tvl)}\n\n`;
    });

    message += `Page ${currentPage}/${totalPages}`;
    return message;
}

function createPoolsKeyboard(pools: PoolDetails[], currentPage: number, totalPages: number): TelegramBot.InlineKeyboardMarkup {
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    // Only add pagination controls as a single row
    const paginationRow: TelegramBot.InlineKeyboardButton[] = [];
    if (currentPage > 1) {
        paginationRow.push({
            text: '◀️ Prev',
            callback_data: `pools_page_${currentPage - 1}`
        });
    }
    paginationRow.push({
        text: `${currentPage}/${totalPages}`,
        callback_data: 'pools_current_page'
    });
    if (currentPage < totalPages) {
        paginationRow.push({
            text: 'Next ▶️',
            callback_data: `pools_page_${currentPage + 1}`
        });
    }
    keyboard.push(paginationRow);
    return { inline_keyboard: keyboard };
}

function formatNumber(num: number): string {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

// Callback query handler for pagination and pool selection
export async function handlePoolsCallback(
    bot: TelegramBot,
    query: TelegramBot.CallbackQuery
): Promise<void> {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const userId = query.from?.id.toString();
    const data = query.data;

    if (!chatId || !userId || !data || !messageId) return;

    const state = userStates.get(userId);
    if (!state) {
        await bot.answerCallbackQuery(query.id, {
            text: 'Session expired. Please use /pools_list again.',
            show_alert: true
        });
        return;
    }

    try {
        // Handle page navigation
        if (data.startsWith('pools_page_')) {
            // Show loading indicator
            await bot.answerCallbackQuery(query.id, {
                text: '📊 Loading new page...'
            });

            const newPage = parseInt(data.split('_')[2]);

            // Validate page number
            if (newPage < 1 || newPage > state.totalPages) {
                await bot.answerCallbackQuery(query.id, {
                    text: '❌ Invalid page number',
                    show_alert: true
                });
                return;
            }

            // Update page state
            state.currentPage = newPage;
            poolsPageState.set(chatId, newPage);

            // Update message with new page
            const message = formatPoolsMessage(state.pools, newPage, state.totalPages);
            const keyboard = createPoolsKeyboard(state.pools, newPage, state.totalPages);

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }
        // Handle current page click (do nothing)
        else if (data === 'pools_current_page') {
            await bot.answerCallbackQuery(query.id);
        }
        // Handle pool selection
        else if (data.startsWith('select_pool_')) {
            await bot.answerCallbackQuery(query.id, {
                text: 'Loading pool details...'
            });

            const poolId = data.replace('select_pool_', '');
            await handlePoolSelection(bot, chatId, poolId);
        }
        // Handle back to pools list
        else if (data === 'pools_back') {
            await bot.answerCallbackQuery(query.id, {
                text: 'Returning to pools list...'
            });

            // Get current page
            const currentPage = poolsPageState.get(chatId) || 1;

            // Update message with pools list
            const message = formatPoolsMessage(state.pools, currentPage, state.totalPages);
            const keyboard = createPoolsKeyboard(state.pools, currentPage, state.totalPages);

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }
    } catch (error) {
        console.error('Error handling pools callback:', error);
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Error processing request. Please try again.',
            show_alert: true
        });
    }
}

async function handlePoolSelection(
    bot: TelegramBot,
    chatId: number,
    poolId: string
): Promise<void> {
    try {
        const [poolDetails] = await getPoolDetails([poolId]);
        if (!poolDetails) {
            await bot.sendMessage(chatId, '❌ Pool not found.');
            return;
        }

        const message = formatPoolDetails(poolDetails);
        const keyboard = createPoolOptionsKeyboard(poolDetails.id);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Error handling pool selection:', error);
        await bot.sendMessage(chatId, '❌ Error fetching pool details. Please try again.');
    }
}

function formatPoolDetails(pool: PoolDetails): string {
    return `🔍 <b>${pool.mintA.symbol}/${pool.mintB.symbol} Pool Details</b>\n\n` +
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
            ],
            [
                { text: 'Back to List', callback_data: 'pools_back' }
            ]
        ]
    };
}

// Export a handler for /pool X selection
export async function handlePoolNumberCommand(
    bot: TelegramBot,
    msg: TelegramBot.Message,
    match: RegExpMatchArray | null
) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    if (!userId) return;
    const state = userStates.get(userId);
    if (!state) {
        await bot.sendMessage(chatId, '❌ Please use /pools_list to view pools first.');
        return;
    }
    if (!match || !match[1]) {
        await bot.sendMessage(chatId, '❌ Invalid pool number.');
        return;
    }
    const poolIndex = parseInt(match[1], 10) - 1;
    if (isNaN(poolIndex) || poolIndex < 0 || poolIndex >= state.pools.length) {
        await bot.sendMessage(chatId, '❌ Invalid pool number.');
        return;
    }
    const pool = state.pools[poolIndex];
    if (!pool) {
        await bot.sendMessage(chatId, '❌ Pool not found.');
        return;
    }
    const message = formatPoolDetails(pool);
    const keyboard = createPoolOptionsKeyboard(pool.id);
    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
} 