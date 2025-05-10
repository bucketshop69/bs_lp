import TelegramBot from 'node-telegram-bot-api';
import { getPoolInfo } from '../../services/raydiumClmm/raydiumUtil';
import { createPosition } from '../../services/raydiumClmm/openPosition';

// State management for LP operations
interface SingleSidedLPState {
    userId: string;
    chatId: number;
    poolId: string;
    currentStep: 'amount' | 'upperPrice' | 'confirm';
    amount?: number;
    upperPrice?: number;
    lastMessageId?: number;
}

// Store user states for LP operations
const lpStates = new Map<string, SingleSidedLPState>();

// Handle single-sided LP callback
export async function handleSingleSidedLPCallback(
    bot: TelegramBot,
    query: TelegramBot.CallbackQuery
): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from?.id.toString();
    const data = query.data;

    if (!chatId || !userId || !data) return;

    const poolId = data.replace('lp_single_', '');

    try {
        // Get current pool info
        const poolInfo = await getPoolInfo(poolId, userId);
        if (!poolInfo) {
            await bot.sendMessage(chatId, '❌ Failed to fetch pool information.');
            return;
        }

        // Initialize state
        const state: SingleSidedLPState = {
            userId,
            chatId,
            poolId,
            currentStep: 'amount'
        };
        lpStates.set(userId, state);

        // Send first message asking for amount
        const message = await bot.sendMessage(
            chatId,
            `💧 <b>Single-Sided LP Setup</b>\n\n` +
            `Please enter the amount you want to provide as liquidity.\n\n` +
            `Current pool price: $${poolInfo.currentPrice}\n\n` +
            `Use /cancel to cancel this operation.`,
            { parse_mode: 'HTML' }
        );

        // Store message ID
        state.lastMessageId = message.message_id;
        lpStates.set(userId, state);

    } catch (error) {
        console.error('Error in handleSingleSidedLPCallback:', error);
        await bot.sendMessage(chatId, '❌ An error occurred while setting up LP position.');
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

        // Update state
        state.amount = amount;
        state.currentStep = 'upperPrice';
        lpStates.set(userId, state);

        // Send message asking for upper price
        const message = await bot.sendMessage(
            chatId,
            `📈 <b>Set Upper Price Range</b>\n\n` +
            `Current price: $${poolInfo.currentPrice}\n` +
            `Your input amount: ${amount}\n\n` +
            `Please enter the upper price range for your position.\n` +
            `This should be higher than the current price.\n\n` +
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
    const upperPrice = parseFloat(msg.text || '');

    if (!userId) return;

    const state = lpStates.get(userId);
    if (!state || state.currentStep !== 'upperPrice') return;

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
                `❌ Please enter a valid price higher than the current price ($${poolInfo.currentPrice}).`
            );
            return;
        }

        // Update state
        state.upperPrice = upperPrice;
        state.currentStep = 'confirm';
        lpStates.set(userId, state);

        // Send confirmation message
        const message = await bot.sendMessage(
            chatId,
            `✅ <b>Confirm Your Position</b>\n\n` +
            `Pool: ${poolInfo.mintA.toString()}/${poolInfo.mintB.toString()}\n` +
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


        // Create position
        const result = await createPosition({
            poolId: state.poolId,
            inputAmount: state.amount!,
            endPrice: state.upperPrice!,
            userId: state.userId
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
    if (!state) return;

    // Clear state
    lpStates.delete(userId);

    await bot.sendMessage(
        chatId,
        '❌ LP position creation cancelled.'
    );
} 