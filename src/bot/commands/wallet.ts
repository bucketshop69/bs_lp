import TelegramBot from 'node-telegram-bot-api';
import { SqliteUserStore } from '../../storage/sqliteUserStore'; // Use SqliteUserStore
import { getSolBalance } from '../../solana/utils';
import { getWalletKeyboard } from '../keyboards'; // Correct relative path

// Initialize SQLite user store (consider passing this in or using a singleton)
const userStore = new SqliteUserStore();

/**
 * Handles the /wallet command, displaying the user's Solana wallet address and balance.
 *
 * @param bot The TelegramBot instance.
 * @param msg The message object from Telegram.
 */
export async function handleWalletCommand(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const userIdString = userId?.toString(); // userStore likely uses string IDs

    if (!userId || !userIdString) {
        console.error("User ID is missing in /wallet command");
        bot.sendMessage(chatId, "Sorry, something went wrong. Could not identify user.");
        return;
    }

    try {
        const user = await userStore.getUser(userIdString);

        if (!user || !user.walletAddress) {
            bot.sendMessage(chatId, "You haven't set up your wallet yet. Please use /start first.");
            return;
        }

        const balance = await getSolBalance(user.walletAddress);

        const messageText = `*Your Wallet*\n\n` +
            `Address: \`${user.walletAddress}\`\n` +
            `Balance: ◎${balance.toFixed(4)} SOL`;

        // Use the keyboard utility function
        const keyboard = getWalletKeyboard(user.walletAddress);

        bot.sendMessage(chatId, messageText, {
            reply_markup: keyboard,
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error(`Error handling /wallet command for user ${userIdString}:`, error);
        bot.sendMessage(chatId, "An error occurred while fetching your wallet information. Please try again later.");
    }
} 