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

            const positionsText = positions.map((pos, index) => {
                const poolTokens = pos.pool.split(' - ');
                const tokenAName = poolTokens[0] || 'TokenA'; // Fallback for safety
                const tokenBName = poolTokens[1] || 'TokenB'; // Fallback for safety

                const rewardsLines = pos.rewardInfos
                    .map(reward => `  • ${Number(reward.amount).toFixed(4)} ${reward.mint}`)
                    .join('\n');

                const positionDetails =
                    `🔹 <b>Position ${index + 1}</b>
Pool: ${pos.pool}
Price Range: ${Number(pos.priceLower).toFixed(4)} - ${Number(pos.priceUpper).toFixed(4)}
💰 <b>Pooled Amounts:</b>
  • ${Number(pos.pooledAmountA).toFixed(4)} ${tokenAName}
  • ${Number(pos.pooledAmountB).toFixed(4)} ${tokenBName}
🏆 <b>Rewards:</b>
${rewardsLines.length > 0 ? rewardsLines : '  • No pending rewards'}
🔧 <b>Actions:</b>
  /close_position
  /claim_fees`; // Note: template literal lines implicitly end with \n if not the last line of the literal
                return positionDetails;
            }).join('\n\n---------------\n\n'); // Divider with blank lines above and below

            await bot.editMessageText(
                `<b>Your Raydium CLMM Positions</b>\n\n${positionsText}`,
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