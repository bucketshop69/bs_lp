// src/bot/bot.ts
import TelegramBot from 'node-telegram-bot-api';
import { handleStartCommand } from './commands/start';
import { handleWalletCommand } from './commands/wallet';
import { handleSwapCommand } from './commands/swap';
import { handlePoolsListCommand, handlePoolsCallback, handlePoolNumberCommand } from './commands/poolsList';
import { handlePoolByIdCommand } from './commands/poolById';
import { handlePoolByTokenCommand } from './commands/poolByToken';
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
        { command: 'swap', description: 'Swap tokens using Jupiter' },
        { command: 'pools_list', description: 'List all available Raydium CLMM pools' },
        { command: 'pool_by_id', description: 'Get details for a specific pool' },
        { command: 'pool_by_token', description: 'Find pools containing a specific token' }
    ]);

    // Listen for commands
    bot.onText(/\/start/, (msg) => handleStartCommand(bot, msg));
    bot.onText(/\/wallet/, (msg) => handleWalletCommand(bot, msg));
    bot.onText(/\/swap/, (msg) => handleSwapCommand(bot, msg));
    bot.onText(/\/pools_list/, (msg) => handlePoolsListCommand(bot, msg));
    bot.onText(/\/pool_by_id/, (msg) => handlePoolByIdCommand(bot, msg));
    bot.onText(/\/pool_by_token/, (msg) => handlePoolByTokenCommand(bot, msg));
    bot.onText(/^\/(\d+)$/, (msg, match) => handlePoolNumberCommand(bot, msg, match));

    // Handle callback queries
    bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id;
        const userId = query.from?.id.toString();
        const messageId = query.message?.message_id;

        if (!chatId || !userId || !messageId) {
            console.error('Missing chatId, userId, or messageId in callback query');
            if (query.id) await bot.answerCallbackQuery(query.id, { text: 'Error processing request.' });
            return;
        }

        let ackText = 'Processing...';

        try {
            // Handle wallet-related callbacks
            if (query.data === 'export_private_key') {
                const user = await userStore.getUser(userId);
                if (user && user.encryptedPrivateKey) {
                    try {
                        const privateKey = decrypt(user.encryptedPrivateKey);
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
                        if (editError.message && editError.message.includes('message is not modified')) {
                            ackText = 'Balance is current.';
                        } else {
                            throw editError;
                        }
                    }
                } else {
                    await bot.editMessageText('Could not refresh balance. Please try /wallet again.', {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: { inline_keyboard: [] }
                    });
                    ackText = 'Refresh failed.';
                }
            }
            // Handle pool-related callbacks
            else if (query.data?.startsWith('pools_') || query.data?.startsWith('select_pool_')) {
                await handlePoolsCallback(bot, query);
                ackText = 'Pool action processed.';
            }
        } catch (error) {
            console.error(`Error handling callback query (${query.data}) for user ${userId}:`, error);
            ackText = 'An error occurred.';
        }

        // Acknowledge the callback
        await bot.answerCallbackQuery(query.id, { text: ackText });
    });

    bot.on('polling_error', (error: Error) => {
        console.error('Polling error:', error.message);
    });

    console.log('Telegram Bot polling started...');

    return bot;
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