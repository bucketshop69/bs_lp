import TelegramBot from 'node-telegram-bot-api';
import { SqliteUserStore } from '../../storage/sqliteUserStore'; // Adjust path as needed
import { fetchAllPositionsInfo } from '../../services/raydiumClmm/myPosition'; // Adjust path as needed

const userStore = new SqliteUserStore();


export async function handleMyPositionsCommand(bot: TelegramBot, msg: TelegramBot.Message) {
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

        const loadingMsg = await bot.sendMessage(chatId, '🔄 Fetching your positions...');

        try {
            const positions = await fetchAllPositionsInfo(userId);

            if (!positions || positions.length === 0) {
                await bot.editMessageText('📭 You don\'t have any Raydium CLMM positions.', {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            const positionsText = await Promise.all(positions.map(async (pos, index) => {
                const poolTokens = pos.name.split(' - ');
                const tokenAName = poolTokens[0] || 'TokenA';
                const tokenBName = poolTokens[1] || 'TokenB';

                const rewardsLines = pos.rewardInfos
                    .map(reward => `  • ${Number(reward.amount).toFixed(4)} ${reward.mint}`)
                    .join('\n');

                const positionDetails =
                    `🔹 <b>Position ${index + 1}</b>\nPool: ${pos.name}\nPrice Range: ${Number(pos.priceLower).toFixed(4)} - ${Number(pos.priceUpper).toFixed(4)}\n💰 <b>Pooled Amounts:</b>\n  • ${Number(pos.pooledAmountA).toFixed(4)} ${tokenAName}\n  • ${Number(pos.pooledAmountB).toFixed(4)} ${tokenBName}\n🏆 <b>Rewards:</b>\n${rewardsLines.length > 0 ? rewardsLines : '  • No pending rewards'}\n🔧 <b>Actions:</b>`;

                // Inline keyboard for closing position
                const inlineKeyboard = {
                    inline_keyboard: [[
                        { text: `Close Position ${index + 1}`, callback_data: `close_position_${index + 1}` },
                        { text: `Claim Fees`, callback_data: `claim_fees_${index + 1}` }
                    ]]
                };

                // Send the position details with the inline keyboard
                await bot.sendMessage(chatId, positionDetails, {
                    parse_mode: 'HTML',
                    reply_markup: inlineKeyboard
                });

                return null; // We don't need to collect text for editMessageText
            }));

            // After sending all positions, edit the loading message to a summary or remove it
            await bot.editMessageText(
                `<b>Your Raydium CLMM Positions</b>\n\n(See each position above for actions)`,
                {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id,
                    parse_mode: 'HTML'
                }
            );

        } catch (error) {
            if (error instanceof Error && error.message === 'User does not have any positions') {
                await bot.editMessageText('📭 You don\'t have any Raydium CLMM positions.', {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                console.error('Error constructing or sending message:', error);
                try {
                    await bot.editMessageText('❌ An error occurred while fetching your positions. (Details logged)', {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id
                    });
                } catch (editError) {
                    console.error('Error editing message to show error state:', editError);
                    await bot.sendMessage(chatId, '❌ An error occurred while fetching your positions. (Details logged)');
                }
            }
        }

    } catch (error) {
        console.error('Error in handleMyPositionsCommand:', error);
        // Avoid sending a message if loadingMsg failed to send, as chatId might be problematic
        // This outer catch is for errors like userStore access or initial bot.sendMessage failure
        if (msg && msg.chat && msg.chat.id) { // Check if we can send a message
            await bot.sendMessage(msg.chat.id, '❌ A critical error occurred. Please try again later.');
        }
    }
}