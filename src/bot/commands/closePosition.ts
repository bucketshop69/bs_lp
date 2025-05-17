import TelegramBot from 'node-telegram-bot-api';
import { SqliteUserStore } from '../../storage/sqliteUserStore';
import { fetchAllPositionsInfo } from '../../services/raydiumClmm/myPosition';
import { removeLiquidity } from '../../services/raydiumClmm/removeLiquidity';

const userStore = new SqliteUserStore();

export async function handleClosePositionCommand(bot: TelegramBot, msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();

    if (!userId) {
        await bot.sendMessage(chatId, '❌ Could not identify user.');
        return;
    }

    try {
        const user = await userStore.getUser(userId);
        if (!user || !user.encryptedPrivateKey) {
            await bot.sendMessage(chatId, '❌ Please set up your wallet first using /start command.');
            return;
        }

        // Get position number from command text (e.g., "/close_position 1")
        const positionNumber = parseInt(msg.text?.split(' ')[1] || '');
        if (isNaN(positionNumber) || positionNumber < 1) {
            await bot.sendMessage(chatId, '❌ Please specify a valid position number. Example: /close_position 1');
            return;
        }

        const loadingMsg = await bot.sendMessage(chatId, '🔄 Fetching position details...');

        try {
            const positions = await fetchAllPositionsInfo(userId);

            if (!positions || positions.length === 0) {
                await bot.editMessageText('📭 You don\'t have any Raydium CLMM positions.', {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            if (positionNumber > positions.length) {
                await bot.editMessageText(`❌ Invalid position number. You have ${positions.length} position(s).`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            const position = positions[positionNumber - 1];

            await bot.editMessageText(`🔄 Closing position ${positionNumber}...`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });

            const result = await removeLiquidity({
                poolId: position.poolId,
                userId: userId,
                closePosition: true
            });

            await bot.editMessageText(
                `✅ Position closed successfully!\nTransaction: https://solscan.io/tx/${result.txId} \n\nUse /my_positions to view your positions. \n\n Use /wallet to manage your wallet.`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            }
            );

        } catch (error) {
            console.error('Error closing position:', error);
            await bot.editMessageText(
                '❌ Failed to close position. Please try again later.', {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            }
            );
        }

    } catch (error) {
        console.error('Error in handleClosePositionCommand:', error);
        await bot.sendMessage(chatId, '❌ A critical error occurred. Please try again later.');
    }
} 