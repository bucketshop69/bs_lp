// src/bot/bot.ts
import TelegramBot from 'node-telegram-bot-api';
import { handleStartCommand } from './commands/start';
import { handleWalletCommand } from './commands/wallet';
import { handleSwapCommand } from './commands/swap';
import { SqliteUserStore } from '../storage/sqliteUserStore';
import { decrypt } from '../utils/encryption';
import { getSolBalance } from '../solana/utils';
import { getWalletKeyboard } from './keyboards';

const userStore = new SqliteUserStore();

export function initializeBot(token: string) {
    if (!token) {
        throw new Error('Telegram Bot Token is required!');
    }

    const bot = new TelegramBot(token, { polling: true });

    // Set up bot commands menu
    bot.setMyCommands([
        { command: 'start', description: 'Start the bot and set up your wallet' },
        { command: 'wallet', description: 'View your wallet information' },
        { command: 'swap', description: 'Swap tokens using Jupiter' }
    ]);

    // Listen for the /start command
    bot.onText(/\/start/, (msg) => {
        handleStartCommand(bot, msg); // Delegate to the command handler
    });

    // Listen for the /wallet command
    bot.onText(/\/wallet/, (msg) => {
        handleWalletCommand(bot, msg); // Delegate to the wallet command handler
    });

    // Listen for the /swap command
    bot.onText(/\/swap/, (msg) => {
        handleSwapCommand(bot, msg); // Delegate to the swap command handler
    });

    // Handle callback queries for wallet actions
    bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id;
        const userId = query.from?.id.toString();
        const messageId = query.message?.message_id;

        if (!chatId || !userId || !messageId) {
            console.error('Missing chatId, userId, or messageId in callback query');
            // Answer callback even if we can't proceed, to stop the loading indicator
            if (query.id) await bot.answerCallbackQuery(query.id, { text: 'Error processing request.' });
            return;
        }

        let ackText = 'Processing...'; // Default acknowledgement text

        try {
            if (query.data === 'export_private_key') {
                const user = await userStore.getUser(userId);
                if (user && user.encryptedPrivateKey) {
                    try {
                        const privateKey = decrypt(user.encryptedPrivateKey);
                        // Send as a new message for security/clarity
                        await bot.sendMessage(chatId, `⚠️ *Warning*: Never share your private key with anyone!\n\n\`${privateKey}\``, { parse_mode: 'Markdown' });
                        ackText = 'Private key sent.';
                    } catch (err) {
                        await bot.sendMessage(chatId, '❌ Failed to decrypt your private key.');
                        ackText = 'Decryption failed.';
                    }
                } else {
                    await bot.sendMessage(chatId, '❌ No private key found for your account.');
                    ackText = 'Key not found.';
                }
            } else if (query.data === 'close_wallet_info') {
                // Edit the message to remove the inline keyboard
                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
                ackText = 'Closed.';
            } else if (query.data === 'refresh_wallet_info') {
                const user = await userStore.getUser(userId);
                if (user && user.walletAddress) {
                    const balance = await getSolBalance(user.walletAddress);
                    const messageText = `*Your Wallet*\n\n` +
                        `Address: \`${user.walletAddress}\`\n` +
                        `Balance: ◎${balance.toFixed(4)} SOL (Refreshed)`;
                    const keyboard = getWalletKeyboard(user.walletAddress);

                    try {
                        await bot.editMessageText(messageText, {
                            chat_id: chatId,
                            message_id: messageId,
                            reply_markup: keyboard,
                            parse_mode: 'Markdown'
                        });
                        ackText = 'Balance refreshed.';
                    } catch (editError: any) {
                        // Handle the "message is not modified" error gracefully
                        if (editError.message && editError.message.includes('message is not modified')) {
                            ackText = 'Balance is current.';
                        } else {
                            // Re-throw other errors to be caught by the outer try-catch
                            throw editError;
                        }
                    }
                } else {
                    // Handle case where user or wallet address isn't found (maybe they ran /start again?)
                    await bot.editMessageText('Could not refresh balance. Please try /wallet again.', {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: { inline_keyboard: [] } // Remove keyboard
                    });
                    ackText = 'Refresh failed.';
                }
            }
        } catch (error) {
            console.error(`Error handling callback query (${query.data}) for user ${userId}:`, error);
            ackText = 'An error occurred.';
            // Optionally send an error message to the chat
            // await bot.sendMessage(chatId, 'An internal error occurred processing your request.');
        }

        // Acknowledge the callback
        await bot.answerCallbackQuery(query.id, { text: ackText });
    });

    // Add more listeners for other commands (/wallet, /lp, etc.) here

    bot.on('polling_error', (error: Error) => {
        console.error('Polling error:', error.message);
        // Handle specific errors if needed
    });

    console.log('Telegram Bot polling started...');

    return bot; // Return the bot instance if needed elsewhere
}

export class Bot {
    private isRunning: boolean = false;

    constructor() {
        // Initialize bot
    }

    public async start(): Promise<void> {
        this.isRunning = true;
        // TODO: Implement bot start logic
    }

    public async stop(): Promise<void> {
        this.isRunning = false;
        // TODO: Implement bot stop logic
    }

    public isBotRunning(): boolean {
        return this.isRunning;
    }
}