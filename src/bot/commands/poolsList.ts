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

interface LpSetupState {
    userId: string;
    chatId: number;
    poolId: string;
    step: 'awaitingTokenSelection' | 'awaitingAmount';
    selectedTokenMint?: string; // Mint address of the token chosen for single LP
    selectedTokenSymbol?: string; // Symbol of the token chosen
    messageIdToEdit: number; // The ID of the message we are editing (pool options/token selection/amount prompt)
}

// Store user states for pagination
const userStates = new Map<string, PoolsListState>();
const activeLpSetups = new Map<string, LpSetupState>(); // Map<userId, LpSetupState>
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
        message += `/${poolNumber} <b>${pool.mintA.symbol}/${pool.mintB.symbol}</b> | Vol: $${formatNumber(pool.day.volume)} | Fees: $${formatNumber(pool.day.volumeFee)} | TVL: $${formatNumber(pool.tvl)}\n`;
    });

    message += `\nPage ${currentPage}/${totalPages}\n\n`;
    message += '💡 <b>Click on the numbers</b> (e.g., /1, /2) to see detailed pool information';
    return message;
}

function createPoolsKeyboard(pools: PoolDetails[], currentPage: number, totalPages: number):
    TelegramBot.InlineKeyboardMarkup {
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
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
    // Note: Not all callbacks require `state`. LpSetup might use a different state.

    try {
        // Handle page navigation for pools list
        if (data.startsWith('pools_page_')) {
            if (!state) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Session expired. Please use /pools_list again.',
                    show_alert: true
                });
                return;
            }
            await bot.answerCallbackQuery(query.id, { text: '📊 Loading new page...' });
            const newPage = parseInt(data.split('_')[2]);
            if (newPage < 1 || newPage > state.totalPages) {
                await bot.answerCallbackQuery(query.id, { text: '❌ Invalid page number', show_alert: true });
                return;
            }
            state.currentPage = newPage;
            poolsPageState.set(chatId, newPage);
            const messageText = formatPoolsMessage(state.pools, newPage, state.totalPages);
            const keyboard = createPoolsKeyboard(state.pools, newPage, state.totalPages);
            await bot.editMessageText(messageText, {
                chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard
            });
        }
        // Handle current page click (do nothing)
        else if (data === 'pools_current_page') {
            await bot.answerCallbackQuery(query.id);
        }
        // Handle pool selection (navigating to pool details)
        else if (data.startsWith('select_pool_')) {
            await bot.answerCallbackQuery(query.id, { text: 'Loading pool details...' });
            const poolId = data.replace('select_pool_', '');
            // We should clear any active LP setup if user selects a new pool directly
            activeLpSetups.delete(userId);
            await handlePoolSelection(bot, chatId, poolId, messageId); // Pass messageId to edit it
        }
        // Handle 'Back to List' from pool details view
        else if (data === 'pools_back') {
            if (!state) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Session expired. Please use /pools_list again.',
                    show_alert: true
                });
                return;
            }
            await bot.answerCallbackQuery(query.id, { text: 'Returning to pools list...' });
            activeLpSetups.delete(userId); // Clear any LP setup state
            const currentPage = poolsPageState.get(chatId) || 1;
            const messageText = formatPoolsMessage(state.pools, currentPage, state.totalPages);
            const keyboard = createPoolsKeyboard(state.pools, currentPage, state.totalPages);
            await bot.editMessageText(messageText, {
                chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard
            });
        }
        // Handle 'Single-Sided LP' button click - Step 1: Show token selection
        else if (data.startsWith('lp_single_')) {
            const poolId = data.replace('lp_single_', '');

            await bot.answerCallbackQuery(query.id, { text: 'Loading token options...' });
            try {
                const [poolDetails] = await getPoolDetails([poolId]);
                if (!poolDetails) {
                    await bot.editMessageText('❌ Pool details not found. Please try again.', { chat_id: chatId, message_id: messageId });
                    return;
                }

                // Ensure mintA and mintB have address and symbol
                if (!poolDetails.mintA?.address || !poolDetails.mintA?.symbol || !poolDetails.mintB?.address || !poolDetails.mintB?.symbol) {
                    console.error('Pool details missing mint information (address/symbol):', poolDetails);
                    await bot.editMessageText('❌ Pool data is incomplete. Cannot proceed.', { chat_id: chatId, message_id: messageId });
                    return;
                }

                activeLpSetups.set(userId, {
                    userId,
                    chatId,
                    poolId,
                    step: 'awaitingTokenSelection',
                    messageIdToEdit: messageId
                });

                const tokenSelectionMessage = `🔍 <b>${poolDetails.mintA.symbol}/${poolDetails.mintB.symbol} Pool</b>

Please select the token you wish to provide for single-sided liquidity:`;
                const tokenSelectionKeyboard = createSingleLpTokenSelectionKeyboard(poolId,
                    { id: poolDetails.mintA.address, symbol: poolDetails.mintA.symbol },
                    { id: poolDetails.mintB.address, symbol: poolDetails.mintB.symbol }
                );

                await bot.editMessageText(tokenSelectionMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: tokenSelectionKeyboard
                });
            } catch (error) {
                console.error('Error in lp_single_ handler:', error);
                await bot.editMessageText('❌ Error fetching pool details for LP. Please try again.', { chat_id: chatId, message_id: messageId });
            }
        }
        // Handle token selection for Single-Sided LP - Step 2: Ask for amount
        else if (data.startsWith('lp_select_token_')) {
            const parts = data.split('_'); // lp_select_token_poolId_tokenId_tokenSymbol
            const poolId = parts[3];
            const selectedTokenMint = parts[4];
            const selectedTokenSymbol = parts[5];

            const lpState = activeLpSetups.get(userId);
            if (!lpState || lpState.poolId !== poolId || lpState.step !== 'awaitingTokenSelection') {
                await bot.answerCallbackQuery(query.id, { text: 'Invalid action or session expired. Please start over.', show_alert: true });
                // Optionally, try to revert to pool options or list if messageId is known
                return;
            }
            await bot.answerCallbackQuery(query.id, { text: `Selected ${selectedTokenSymbol}. Please wait...` });

            try {
                const [poolDetails] = await getPoolDetails([poolId]); // Fetch again for latest price
                if (!poolDetails) {
                    await bot.editMessageText('❌ Pool details not found. Please try again.', { chat_id: chatId, message_id: lpState.messageIdToEdit });
                    activeLpSetups.delete(userId);
                    return;
                }

                lpState.step = 'awaitingAmount';
                lpState.selectedTokenMint = selectedTokenMint;
                lpState.selectedTokenSymbol = selectedTokenSymbol;
                activeLpSetups.set(userId, lpState);

                // Using pool.price (assuming it's a number) and toString() for full precision as seen in screenshot
                const currentPriceStr = typeof poolDetails.price === 'number' ? poolDetails.price.toString() : poolDetails.price;

                const amountPromptMessage =
                    `💧 <b>Single-Sided LP Setup for ${selectedTokenSymbol}</b>

` +
                    `Pool: ${poolDetails.mintA.symbol}/${poolDetails.mintB.symbol}
` +
                    `Please enter the amount of <b>${selectedTokenSymbol}</b> you want to provide as liquidity.

` +
                    `Current pool price: $${currentPriceStr}

` +
                    `Use /cancel to cancel this operation.`;

                await bot.editMessageText(amountPromptMessage, {
                    chat_id: chatId,
                    message_id: lpState.messageIdToEdit,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Token Selection', callback_data: `lp_single_${poolId}` }]] } // Option to go back to token selection
                });
            } catch (error) {
                console.error('Error in lp_select_token_ handler:', error);
                await bot.editMessageText('❌ Error preparing LP amount input. Please try again.', { chat_id: chatId, message_id: lpState.messageIdToEdit });
                activeLpSetups.delete(userId);
            }
        }
        // Handle 'Back to Options' from token selection screen
        else if (data.startsWith('lp_back_to_options_')) {
            const poolId = data.replace('lp_back_to_options_', '');
            const lpState = activeLpSetups.get(userId);
            if (!lpState || lpState.poolId !== poolId) { // Check if there's an active setup for this pool
                // If no state, or state is for different pool, maybe just try to show options if possible
                // but safer to assume we need to go back to a known state.
                // For now, just log and perhaps send a generic message if messageId unknown.
            }

            await bot.answerCallbackQuery(query.id, { text: 'Returning to pool options...' });
            activeLpSetups.delete(userId); // Clear the LP setup state

            try {
                const [poolDetails] = await getPoolDetails([poolId]);
                if (!poolDetails) {
                    await bot.editMessageText('❌ Pool details not found. Please try again.', { chat_id: chatId, message_id: messageId });
                    return;
                }
                const originalMessage = formatPoolDetails(poolDetails);
                const originalKeyboard = createPoolOptionsKeyboard(poolId);
                await bot.editMessageText(originalMessage, {
                    chat_id: chatId,
                    message_id: messageId, // Use the current messageId from the query
                    parse_mode: 'HTML',
                    reply_markup: originalKeyboard
                });
            } catch (error) {
                console.error('Error in lp_back_to_options_ handler:', error);
                await bot.editMessageText('❌ Error returning to pool options. Please try again.', { chat_id: chatId, message_id: messageId });
            }
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
    poolId: string,
    messageIdToUpdate?: number // Optional: if we want to edit an existing message
): Promise<void> {
    try {
        const [poolDetails] = await getPoolDetails([poolId]);
        if (!poolDetails) {
            if (messageIdToUpdate) {
                await bot.editMessageText('❌ Pool not found.', { chat_id: chatId, message_id: messageIdToUpdate });
            } else {
                await bot.sendMessage(chatId, '❌ Pool not found.');
            }
            return;
        }

        const message = formatPoolDetails(poolDetails);
        const keyboard = createPoolOptionsKeyboard(poolDetails.id);

        if (messageIdToUpdate) {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageIdToUpdate,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else {
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }
    } catch (error) {
        console.error('Error handling pool selection:', error);
        if (messageIdToUpdate) {
            await bot.editMessageText('❌ Error fetching pool details. Please try again.', { chat_id: chatId, message_id: messageIdToUpdate });
        } else {
            await bot.sendMessage(chatId, '❌ Error fetching pool details. Please try again.');
        }
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
                // { text: 'Dual-Sided LP', callback_data: `lp_dual_${poolId}` }
            ],
            [
                { text: 'Back to List', callback_data: 'pools_back' }
            ]
        ]
    };
}

function createSingleLpTokenSelectionKeyboard(
    poolId: string,
    tokenA: { id: string; symbol: string },
    tokenB: { id: string; symbol: string }
): TelegramBot.InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                { text: `Provide ${tokenA.symbol}`, callback_data: `lp_select_token_${poolId}_${tokenA.id}_${tokenA.symbol}` },
                { text: `Provide ${tokenB.symbol}`, callback_data: `lp_select_token_${poolId}_${tokenB.id}_${tokenB.symbol}` }
            ],
            [
                { text: '⬅️ Back to Options', callback_data: `lp_back_to_options_${poolId}` }
            ]
        ]
    };
}

// Add command handler for pool numbers (e.g., /1, /2)
export function handlePoolNumberCommand(bot: TelegramBot, msg: TelegramBot.Message, match: RegExpMatchArray | null) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();

    if (!userId || !match) {
        console.log('Missing userId or match');
        return;
    }

    const state = userStates.get(userId);

    if (!state) {
        bot.sendMessage(chatId, '❌ Please use /pools_list to view pools first.');
        return;
    }

    const poolIndex = parseInt(match[1], 10) - 1;

    if (isNaN(poolIndex) || poolIndex < 0 || poolIndex >= state.pools.length) {
        bot.sendMessage(chatId, '❌ Invalid pool number.');
        return;
    }

    const pool = state.pools[poolIndex];

    if (!pool) {
        bot.sendMessage(chatId, '❌ Pool not found.');
        return;
    }

    const message = formatPoolDetails(pool);
    const keyboard = createPoolOptionsKeyboard(pool.id);

    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
} 