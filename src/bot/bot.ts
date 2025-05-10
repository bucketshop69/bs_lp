// src/bot/bot.ts
import TelegramBot from 'node-telegram-bot-api';
import { handleStartCommand } from './commands/start';
import { handleWalletCommand } from './commands/wallet';
import { handleSwapCommand } from './commands/swap';
import { handlePoolsListCommand, handlePoolsCallback, handlePoolNumberCommand } from './commands/poolsList';
import { handlePoolByIdCommand } from './commands/poolById';
import { handlePoolByTokenCommand } from './commands/poolByToken';
import { handleMyPositionsCommand } from './commands/myPositions';
import { SqliteUserStore } from '../storage/sqliteUserStore';
import { decrypt } from '../utils/encryption';
import { getSolBalance } from '../solana/utils';
import { getWalletKeyboard } from './keyboards';
import { handleSingleSidedLPCallback, handleAmountInput, handleUpperPriceInput, handleConfirmation, handleCancellation } from './commands/lpCommands';

const userStore = new SqliteUserStore();

let botInstance: TelegramBot | null = null;
let isShuttingDown = false;
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000; // 5 seconds
let pollingRestartTimer: NodeJS.Timeout | null = null;


// Clean up resources function
function cleanupResources() {
    if (pollingRestartTimer) {
        clearTimeout(pollingRestartTimer);
        pollingRestartTimer = null;
    }

    if (botInstance) {
        try {
            isPolling = false;
            botInstance.stopPolling();
        } catch (err) {
            console.error('Error stopping polling:', err);
        }
        botInstance = null;
    }

    retryCount = 0;
    isShuttingDown = false;
}
let isPolling = false;

function startBotPolling(bot: TelegramBot) {
    if (isPolling) {
        console.log('Bot is already polling');
        return;
    }

    console.log('Starting Telegram Bot polling...');
    bot.startPolling().then(() => {
        isPolling = true;
        console.log('Bot polling started successfully');
    }).catch((error) => {
        console.error('Error starting bot polling:', error);
        isPolling = false;

        // If it's a conflict error, try to stop and restart
        if (error.response?.body?.error_code === 409 ||
            (error.message && error.message.includes('409 Conflict'))) {
            console.log('Bot already polling, attempting to stop and restart...');

            bot.stopPolling().then(() => {
                // Wait a bit before restarting
                setTimeout(() => {
                    bot.startPolling().then(() => {
                        isPolling = true;
                        console.log('Bot polling restarted successfully');
                    }).catch(err => {
                        console.error('Failed to restart polling:', err);
                    });
                }, 2000);
            }).catch(stopErr => {
                console.error('Failed to stop polling:', stopErr);
            });
        }
    });
}
export function initializeBot(token: string) {
    if (!token) {
        throw new Error('Telegram Bot Token is required!');
    }

    // Prevent multiple initializations
    if (isShuttingDown) {
        console.log('Bot is currently shutting down, waiting...');
        return null;
    }

    // Clean up any existing bot instance
    cleanupResources();


    // Create new bot instance with more robust configuration
    const bot = new TelegramBot(token, {
        polling: {
            interval: 1000,
            autoStart: false,
            params: {
                timeout: 30
            }
        }
    });

    // Set botInstance after creation
    botInstance = bot;

    // Set up bot commands menu
    bot.setMyCommands([
        { command: 'start', description: 'Start the bot and set up your wallet' },
        { command: 'wallet', description: 'View your wallet information' },
        // { command: 'swap', description: 'Swap tokens using Jupiter' },
        { command: 'pools_list', description: 'List all available Raydium CLMM pools' },
        { command: 'pool_by_id', description: 'Get details for a specific pool' },
        { command: 'my_positions', description: 'View your Raydium CLMM positions' },
        // { command: 'pool_by_token', description: 'Find pools containing a specific token' }
    ]);

    // Listen for commands
    bot.onText(/\/start/, (msg) => handleStartCommand(bot, msg));
    bot.onText(/\/wallet/, (msg) => handleWalletCommand(bot, msg));
    bot.onText(/\/swap/, (msg) => handleSwapCommand(bot, msg));
    bot.onText(/\/pools_list/, (msg) => handlePoolsListCommand(bot, msg));
    bot.onText(/\/pool_by_id/, (msg) => handlePoolByIdCommand(bot, msg));
    bot.onText(/\/pool_by_token/, (msg) => handlePoolByTokenCommand(bot, msg));
    bot.onText(/\/my_positions/, (msg) => handleMyPositionsCommand(bot, msg));
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
            // Handle LP-related callbacks
            if (query.data?.startsWith('lp_single_')) {
                await handleSingleSidedLPCallback(bot, query);
                ackText = 'Starting LP setup...';
            }
            // Handle wallet-related callbacks
            else if (query.data === 'export_private_key') {
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
            console.error('Error handling callback query:', error);
            ackText = 'Error processing request.';
        }

        if (query.id) {
            await bot.answerCallbackQuery(query.id, { text: ackText });
        }
    });

    // Handle text messages for LP setup
    bot.on('message', async (msg) => {
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const userId = msg.from?.id.toString();

        if (!userId) return;

        try {
            // Handle LP setup commands
            if (msg.text === '/confirm') {
                await handleConfirmation(bot, msg);
            } else if (msg.text === '/cancel') {
                await handleCancellation(bot, msg);
            } else {
                // Handle numeric inputs for LP setup
                await handleAmountInput(bot, msg);
                await handleUpperPriceInput(bot, msg);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            await bot.sendMessage(chatId, '❌ An error occurred while processing your message.');
        }
    });

    // Handle polling errors
    bot.on('polling_error', (error: Error) => {
        console.error('Polling error:', error.message);

        if (error.message.includes('409 Conflict')) {
            isShuttingDown = true;
            console.log('Conflict detected, stopping polling...');

            bot.stopPolling().catch(err => {
                console.error('Error stopping polling:', err);
            }).finally(() => {
                if (retryCount < MAX_RETRIES) {
                    retryCount++;
                    console.log(`Attempting to restart polling in ${RETRY_DELAY_MS / 1000} seconds (attempt ${retryCount}/${MAX_RETRIES})...`);

                    // Clear any existing timer
                    if (pollingRestartTimer) {
                        clearTimeout(pollingRestartTimer);
                    }

                    // Set a new timer for restart
                    pollingRestartTimer = setTimeout(() => {
                        console.log('Restarting polling...');
                        botInstance = null;
                        initializeBot(token);
                    }, RETRY_DELAY_MS);
                } else {
                    console.error(`Failed to resolve conflict after ${MAX_RETRIES} attempts. Bot stopped.`);
                    cleanupResources();
                }
            });
        }
    });
    bot.on('webhook_error', (error) => {
        console.error('Webhook error:', error.message);
    });

    // Add error handler for general bot errors
    bot.on('error', (error) => {
        console.error('Bot error:', error.message);
    });
    // Start polling
    startBotPolling(bot);

    process.on('SIGINT', () => shutdownBot(bot));
    process.on('SIGTERM', () => shutdownBot(bot));

    return bot;
}
function shutdownBot(bot: TelegramBot) {
    console.log('Shutting down bot...');
    isPolling = false;
    bot.stopPolling().catch(err => {
        console.error('Error stopping polling during shutdown:', err);
    });
    console.log('Bot shutdown complete');
    process.exit(0);
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