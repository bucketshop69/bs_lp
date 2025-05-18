// src/bot/bot.ts
import TelegramBot from 'node-telegram-bot-api';
import { handleStartCommand } from './commands/start';
import { handleWalletCommand } from './commands/wallet';
import { handleSwapCommand } from './commands/swap';
import { handlePoolsListCommand, handlePoolsCallback, handlePoolNumberCommand } from './commands/poolsList';
import { handlePoolByIdCommand } from './commands/poolById';
import { handlePoolByTokenCommand } from './commands/poolByToken';
import { handleMyPositionsCommand } from './commands/myPositions';
import { handleClosePositionCommand } from './commands/closePosition';
import { SqliteUserStore } from '../storage/sqliteUserStore';
import { decrypt } from '../utils/encryption';
import { getSolBalance } from '../solana/utils';
import { getWalletKeyboard } from './keyboards';
import { handleSingleSidedLPCallback, handleAmountInput, handleUpperPriceInput, handleConfirmation, handleCancellation, lpStates } from './commands/lpCommands';
import { harvestPositionRewards } from '../services/raydiumClmm/claimFees';
import { fetchAllPositionsInfo } from '../services/raydiumClmm/myPosition';

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

    // Check for any existing webhook
    bot.getWebHookInfo().then(info => {
        if (info.url) {
            console.log('Removing existing webhook before polling');
            return bot.deleteWebHook();
        }
    }).catch(err => {
        console.error('Error checking webhook:', err);
    }).finally(() => {
        console.log('Starting Telegram Bot polling with safe parameters...');

        // Set options for more stability
        const pollingOptions = {
            polling: {
                interval: 2000,  // Longer interval
                timeout: 60,     // Longer timeout
                limit: 100,      // Fetch more updates
                retryTimeout: 5000  // Wait longer between retries
            }
        };

        // Start polling with better options
        bot.startPolling(pollingOptions).then(() => {
            isPolling = true;
            console.log('Bot polling started successfully');
        }).catch((error) => {
            console.error('Error starting bot polling:', error);
            isPolling = false;

            // If it's a conflict error, wait longer before retry
            if (error.response?.body?.error_code === 409 ||
                (error.message && error.message.includes('409 Conflict'))) {
                console.log('Bot already polling (conflict), waiting 15 seconds before retry...');

                // Stop fully first
                bot.stopPolling().then(() => {
                    // Wait significantly longer before trying again
                    setTimeout(() => {
                        console.log('Attempting to restart polling after conflict...');
                        cleanupResources(); // Ensure clean state

                        // Create a fresh bot instance
                        const token = process.env.BS_LP_TELEGRAM_BOT_TOKEN || '';
                        if (token) {
                            botInstance = null;
                            initializeBot(token);
                        } else {
                            console.error('Cannot restart - missing token');
                        }
                    }, 15000); // 15 second delay
                }).catch(stopErr => {
                    console.error('Failed to stop polling:', stopErr);
                });
            }
        });
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

    // If there's an existing bot instance, stop it properly before creating a new one
    if (botInstance) {
        console.log('Existing bot instance detected, stopping it first...');
        try {
            botInstance.stopPolling();
            // Wait a moment to ensure polling has stopped
            setTimeout(() => {
                console.log('Previous bot instance stopped, continuing initialization...');
                botInstance = null;
                // Clean up resources
                cleanupResources();
            }, 2000);
            return null;
        } catch (err) {
            console.error('Error stopping existing bot instance:', err);
        }
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
        { command: 'my_positions', description: 'View your Raydium CLMM positions' },
        // { command: 'pool_by_id', description: 'Get details for a specific pool' },
        // { command: 'pool_by_token', description: 'Find pools containing a specific token' }
    ]);

    // Listen for commands
    bot.onText(/\/start/, (msg) => handleStartCommand(bot, msg));
    bot.onText(/\/wallet/, (msg) => handleWalletCommand(bot, msg));
    bot.onText(/\/swap/, (msg) => handleSwapCommand(bot, msg));
    bot.onText(/\/pools_list/, (msg) => handlePoolsListCommand(bot, msg));
    // bot.onText(/\/pool_by_id/, (msg) => handlePoolByIdCommand(bot, msg));
    // bot.onText(/\/pool_by_token/, (msg) => handlePoolByTokenCommand(bot, msg));
    bot.onText(/\/my_positions/, (msg) => handleMyPositionsCommand(bot, msg));
    bot.onText(/\/close_position/, (msg) => handleClosePositionCommand(bot, msg));
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
            // Handle close position button
            if (query.data?.startsWith('close_position_')) {
                const positionNumber = query.data.split('_')[2];
                // Synthesize a message object for handleClosePositionCommand
                // Only chat.id, from.id, and text are used, so this is safe
                const syntheticMsg = {
                    chat: { id: chatId },
                    from: { id: Number(userId) },
                    text: `/close_position ${positionNumber}`
                };
                await handleClosePositionCommand(bot, syntheticMsg as any);
                ackText = `Closing position ${positionNumber}...`;
            }
            // Handle LP-related callbacks
            else if (query.data?.startsWith('lp_single_') || query.data?.startsWith('lp_token_')) {
                await handleSingleSidedLPCallback(bot, query);
                ackText = 'Processing LP setup...';
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
            // Handle claim fees button
            else if (query.data?.startsWith('claim_fees_')) {
                const positionNumber = parseInt(query.data.split('_')[2], 10);
                try {
                    // Fetch user positions to get the correct nftMint
                    const userIdStr = userId.toString();
                    const positions = await fetchAllPositionsInfo(userIdStr);
                    if (!positions || positionNumber < 1 || positionNumber > positions.length) {
                        await bot.sendMessage(chatId, '❌ Invalid position number.');
                        return;
                    }
                    const position = positions[positionNumber - 1];
                    const nftMint = position.nft;
                    // Notify user that claiming is in progress
                    await bot.sendMessage(chatId, '🔄 Claiming fees for your position...');
                    const txIds = await harvestPositionRewards(nftMint, userIdStr);
                    if (txIds && txIds.length > 0) {
                        await bot.sendMessage(chatId, `✅ Fees claimed successfully!\nTransaction(s):\n${txIds.map(txId => `https://solscan.io/tx/${txId}`).join('\n')}`);
                    } else {
                        await bot.sendMessage(chatId, '✅ Fees claimed, but no transaction IDs returned.');
                    }
                } catch (error) {
                    console.error('Error claiming fees:', error);
                    await bot.sendMessage(chatId, '❌ Failed to claim fees. Please try again later.');
                }
                ackText = `Claiming fees for position ${positionNumber}...`;
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
                // Get the current state to determine which handler to call
                const state = lpStates.get(userId);

                if (state) {
                    // Call only the relevant handler based on the current step
                    if (state.currentStep === 'amount') {
                        await handleAmountInput(bot, msg);
                    } else if (state.currentStep === 'upperPrice') {
                        await handleUpperPriceInput(bot, msg);
                    }
                }
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
            isPolling = false;

            // Stop polling completely
            bot.stopPolling().catch(err => {
                console.error('Error stopping polling:', err);
            }).finally(() => {
                // Wait 10 seconds before any retry to ensure other instances have time to terminate
                const conflictDelayMs = 10000;
                console.log(`Waiting ${conflictDelayMs / 1000} seconds before attempting to restart...`);

                // Clear any existing timer
                if (pollingRestartTimer) {
                    clearTimeout(pollingRestartTimer);
                }

                if (retryCount < MAX_RETRIES) {
                    retryCount++;
                    console.log(`Will attempt to restart polling (attempt ${retryCount}/${MAX_RETRIES})...`);

                    // Set a new timer for restart with longer delay for conflicts
                    pollingRestartTimer = setTimeout(() => {
                        console.log('Restarting polling with fresh instance...');
                        // Ensure complete cleanup before retry
                        cleanupResources();
                        botInstance = null;
                        // Use a new bot instance for next retry
                        setTimeout(() => {
                            initializeBot(token);
                        }, 1000);
                    }, conflictDelayMs);
                } else {
                    console.error(`Failed to resolve conflict after ${MAX_RETRIES} attempts. Bot stopped.`);
                    cleanupResources();
                    process.exit(1); // Exit with error code to trigger container restart
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