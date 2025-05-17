import TelegramBot from 'node-telegram-bot-api';
import { getPoolInfo } from '../../services/raydiumClmm/raydiumUtil';
import { createPosition } from '../../services/raydiumClmm/openPosition';
import { getPoolDetails } from '../../services/raydiumService';

// State management for LP operations
interface SingleSidedLPState {
    userId: string;
    chatId: number;
    poolId: string;
    currentStep: 'tokenSelection' | 'amount' | 'upperPrice' | 'confirm';
    amount?: number;
    upperPrice?: number;
    lastMessageId?: number;
    selectedTokenMint?: string; // Store selected token mint address
    selectedTokenSymbol?: string; // Store selected token symbol
    awaitingPriceInput?: boolean; // Flag to prevent automatic validation
}

// Store user states for LP operations
export const lpStates = new Map<string, SingleSidedLPState>();

// Create token selection keyboard
function createTokenSelectionKeyboard(
    poolId: string,
    tokenA: { address: string; symbol: string },
    tokenB: { address: string; symbol: string }
): TelegramBot.InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                { text: `Provide ${tokenA.symbol}`, callback_data: `lp_token_${poolId}_A` },
                { text: `Provide ${tokenB.symbol}`, callback_data: `lp_token_${poolId}_B` }
            ],
            [
                { text: '⬅️ Back to Options', callback_data: `pools_back` }
            ]
        ]
    };
}

// Handle single-sided LP callback
export async function handleSingleSidedLPCallback(
    bot: TelegramBot,
    query: TelegramBot.CallbackQuery
): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from?.id.toString();
    const data = query.data;
    const messageId = query.message?.message_id;

    if (!chatId || !userId || !data || !messageId) return;

    // Check if this is a token selection callback
    if (data.startsWith('lp_token_')) {
        await handleTokenSelection(bot, query);
        return;
    }

    // Otherwise, it's the initial LP setup callback
    const poolId = data.replace('lp_single_', '');

    try {
        // Get pool details for token information
        const [poolDetails] = await getPoolDetails([poolId]);
        if (!poolDetails) {
            await bot.sendMessage(chatId, '❌ Failed to fetch pool details.');
            return;
        }

        // Initialize state
        const state: SingleSidedLPState = {
            userId,
            chatId,
            poolId,
            currentStep: 'tokenSelection',
            lastMessageId: messageId
        };
        lpStates.set(userId, state);

        // Send token selection message in place of the existing message
        const tokenSelectionMessage = `🔍 <b>${poolDetails.mintA.symbol}/${poolDetails.mintB.symbol} Pool</b>\n\n` +
            `Please select the token you wish to provide for single-sided liquidity:`;

        // Create keyboard with options for both tokens
        const keyboard = createTokenSelectionKeyboard(
            poolId,
            { address: poolDetails.mintA.address, symbol: poolDetails.mintA.symbol },
            { address: poolDetails.mintB.address, symbol: poolDetails.mintB.symbol }
        );

        // Edit the original message instead of sending a new one
        await bot.editMessageText(tokenSelectionMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });

    } catch (error) {
        console.error('Error in handleSingleSidedLPCallback:', error);
        await bot.sendMessage(chatId, '❌ An error occurred while setting up LP position.');
    }
}

// Handle token selection
async function handleTokenSelection(
    bot: TelegramBot,
    query: TelegramBot.CallbackQuery
): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from?.id.toString();
    const data = query.data;
    const messageId = query.message?.message_id;

    if (!chatId || !userId || !data || !messageId) return;

    // Parse the callback data: lp_token_poolId_A or lp_token_poolId_B
    const parts = data.split('_');
    if (parts.length < 4) {
        await bot.answerCallbackQuery(query.id, { text: 'Invalid token selection data', show_alert: true });
        return;
    }

    const poolId = parts[2];
    const tokenSelection = parts[3]; // 'A' or 'B'

    try {
        // Get the state and validate
        const state = lpStates.get(userId);
        if (!state || state.poolId !== poolId || state.currentStep !== 'tokenSelection') {
            await bot.answerCallbackQuery(query.id, {
                text: 'Session expired or invalid. Please start again.',
                show_alert: true
            });
            return;
        }

        // Get pool details to determine which token was selected
        const [poolDetails] = await getPoolDetails([poolId]);
        if (!poolDetails) {
            await bot.sendMessage(chatId, '❌ Failed to fetch pool details.');
            return;
        }

        // Determine which token was selected based on tokenSelection ('A' or 'B')
        const selectedTokenMint = tokenSelection === 'A' ? poolDetails.mintA.address : poolDetails.mintB.address;
        const selectedTokenSymbol = tokenSelection === 'A' ? poolDetails.mintA.symbol : poolDetails.mintB.symbol;

        await bot.answerCallbackQuery(query.id, {
            text: `Selected ${selectedTokenSymbol}. Please wait...`
        });

        // Get current pool info
        const poolInfo = await getPoolInfo(poolId, userId);
        if (!poolInfo) {
            await bot.sendMessage(chatId, '❌ Failed to fetch pool information.');
            return;
        }

        // Update state with selected token
        state.selectedTokenMint = selectedTokenMint;
        state.selectedTokenSymbol = selectedTokenSymbol;
        state.currentStep = 'amount';
        lpStates.set(userId, state);

        // Send message asking for amount
        const message = `💧 <b>Single-Sided LP Setup for ${selectedTokenSymbol}</b>\n\n` +
            `Please enter the amount of <b>${selectedTokenSymbol}</b> you want to provide as liquidity.\n\n` +
            `Current pool price: $${poolInfo.currentPrice.toString()}\n\n` +
            `Use /cancel to cancel this operation.`;

        // Edit the existing message with a back button to token selection
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ Back to Token Selection', callback_data: `lp_single_${poolId}` }]
                ]
            }
        });

        // Store message ID
        state.lastMessageId = messageId;
        lpStates.set(userId, state);
    } catch (error) {
        console.error('Error in handleTokenSelection:', error);
        await bot.sendMessage(chatId, '❌ An error occurred while processing token selection.');
    }
}

// Handle amount input
export async function handleAmountInput(
    bot: TelegramBot,
    msg: TelegramBot.Message
): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const amount = parseFloat(msg.text || '');

    if (!userId) return;

    const state = lpStates.get(userId);
    if (!state || state.currentStep !== 'amount') return;

    if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Please enter a valid positive number.');
        return;
    }

    try {
        // Get current pool info
        const poolInfo = await getPoolInfo(state.poolId, userId);
        if (!poolInfo) {
            await bot.sendMessage(chatId, '❌ Failed to fetch pool information.');
            return;
        }

        // Confirm amount was accepted
        await bot.sendMessage(
            chatId,
            `✅ Amount accepted: ${amount} ${state.selectedTokenSymbol || ''}`
        );

        // Update state to move to price input step
        state.amount = amount;
        state.currentStep = 'upperPrice';
        state.awaitingPriceInput = true; // Set flag to indicate we're waiting for price input
        lpStates.set(userId, state);

        // Send clearer message asking for upper price
        const message = await bot.sendMessage(
            chatId,
            `📈 <b>NEXT STEP: Set Upper Price Range</b>\n\n` +
            `Current price: $${poolInfo.currentPrice}\n` +
            `Your input: ${amount} ${state.selectedTokenSymbol || ''}\n\n` +
            `Please enter the upper price range for your position.\n` +
            `This must be a number higher than the current price ($${poolInfo.currentPrice}).\n\n` +
            `Use /cancel to cancel this operation.`,
            { parse_mode: 'HTML' }
        );

        // Store message ID
        state.lastMessageId = message.message_id;
        lpStates.set(userId, state);

    } catch (error) {
        console.error('Error in handleAmountInput:', error);
        await bot.sendMessage(chatId, '❌ An error occurred while processing your input.');
    }
}

// Handle upper price input
export async function handleUpperPriceInput(
    bot: TelegramBot,
    msg: TelegramBot.Message
): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const text = msg.text || '';

    if (!userId) return;

    const state = lpStates.get(userId);
    if (!state || state.currentStep !== 'upperPrice') return;

    // Only process actual text input (not empty or commands)
    if (!text || text.startsWith('/')) return;

    // Skip if the message is the same as the NEXT STEP message
    if (text.includes('NEXT STEP')) return;

    console.log(`Processing price input: "${text}" from user ${userId}`);

    const upperPrice = parseFloat(text);

    try {
        // Get current pool info
        const poolInfo = await getPoolInfo(state.poolId, userId);
        if (!poolInfo) {
            await bot.sendMessage(chatId, '❌ Failed to fetch pool information.');
            return;
        }

        if (isNaN(upperPrice) || upperPrice <= poolInfo.currentPrice) {
            await bot.sendMessage(
                chatId,
                `❌ Price error: Please enter a valid numeric price value higher than the current price ($${poolInfo.currentPrice}).\n\nFor example: ${Math.ceil(poolInfo.currentPrice * 1.1)}`
            );
            return;
        }

        // Clear the awaiting flag
        state.awaitingPriceInput = false;

        // Update state
        state.upperPrice = upperPrice;
        state.currentStep = 'confirm';
        lpStates.set(userId, state);

        // Get pool details to get token symbols
        const [poolDetails] = await getPoolDetails([state.poolId]);
        const tokenASymbol = poolDetails?.mintA.symbol || 'TokenA';
        const tokenBSymbol = poolDetails?.mintB.symbol || 'TokenB';

        // Send confirmation message
        const message = await bot.sendMessage(
            chatId,
            `✅ <b>Confirm Your Position</b>\n\n` +
            `Pool: ${tokenASymbol}/${tokenBSymbol}\n` +
            `Input Token: ${state.selectedTokenSymbol}\n` +
            `Input Amount: ${state.amount}\n` +
            `Current Price: $${poolInfo.currentPrice}\n` +
            `Upper Price: $${upperPrice}\n` +
            `Lower Price: $${poolInfo.currentPrice} (current price)\n\n` +
            `Please confirm to proceed with creating your position.\n\n` +
            `Use /confirm to proceed or /cancel to cancel.`,
            { parse_mode: 'HTML' }
        );

        // Store message ID
        state.lastMessageId = message.message_id;
        lpStates.set(userId, state);

    } catch (error) {
        console.error('Error in handleUpperPriceInput:', error);
        await bot.sendMessage(chatId, '❌ An error occurred while processing your input.');
    }
}

// Handle confirmation
export async function handleConfirmation(
    bot: TelegramBot,
    msg: TelegramBot.Message
): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();

    if (!userId) return;

    const state = lpStates.get(userId);
    if (!state || state.currentStep !== 'confirm') return;

    try {
        // Get current pool info
        const poolInfo = await getPoolInfo(state.poolId, userId);
        if (!poolInfo) {
            await bot.sendMessage(chatId, '❌ Failed to fetch pool information.');
            return;
        }
        console.log(state);

        // Create position - pass the selected token mint
        const result = await createPosition({
            poolId: state.poolId,
            inputAmount: state.amount!,
            endPrice: state.upperPrice!,
            userId: state.userId,
            selectedTokenMint: state.selectedTokenMint
        });

        if (!result) {
            throw new Error('Failed to create position');
        }

        // Clear state
        lpStates.delete(userId);

        // Send success message
        await bot.sendMessage(
            chatId,
            `🎉 <b>Position Created Successfully!</b>\n\n` +
            `Transaction ID: <a href="https://solscan.io/tx/${result.txId}">${result.txId}</a>\n` +
            `NFT: ${result.nft}\n\n` +
            `Your position has been created and you can view it on Raydium.\n\n` +
            `Use /my_positions to view all your positions.`,
            { parse_mode: 'HTML' }
        );

    } catch (error) {
        console.error('Error in handleConfirmation:', error);
        await bot.sendMessage(
            chatId,
            '❌ Failed to create position. Please try again later.'
        );
    }
}

// Handle cancellation
export async function handleCancellation(
    bot: TelegramBot,
    msg: TelegramBot.Message
): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();

    if (!userId) return;

    const state = lpStates.get(userId);
    if (!state) {
        await bot.sendMessage(
            chatId,
            '❓ No active operation to cancel. You can start a new operation with /pools_list.'
        );
        return;
    }

    // Get info about what was cancelled for better feedback
    let cancelledOperation = "LP setup";
    if (state.currentStep === 'amount') {
        cancelledOperation = `${state.selectedTokenSymbol} amount input`;
    } else if (state.currentStep === 'upperPrice') {
        cancelledOperation = `price range setting for ${state.amount} ${state.selectedTokenSymbol}`;
    } else if (state.currentStep === 'confirm') {
        cancelledOperation = `position confirmation with ${state.amount} ${state.selectedTokenSymbol}`;
    }

    // Clear state
    lpStates.delete(userId);

    // Send cancellation message with more detail
    await bot.sendMessage(
        chatId,
        `✅ Operation cancelled: ${cancelledOperation}\n\nYou can start again with the /pools_list command or use /help to see all available commands.`
    );
} 