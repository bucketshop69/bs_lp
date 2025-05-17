import TelegramBot from 'node-telegram-bot-api';
import { SqliteUserStore } from '../../storage/sqliteUserStore';
import { Wallet } from '../../solana/wallet';
import { encrypt } from '../../utils/encryption';

// Initialize SQLite user store
const userStore = new SqliteUserStore();

export async function handleStartCommand(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const userName = msg.from?.first_name || 'there';

    if (!userId || !msg.from) {
        await bot.sendMessage(chatId, '❌ Error: Could not identify user. Please try again.');
        return;
    }

    try {
        // Check if user already exists
        const existingUser = await userStore.getUser(userId);
        let walletAddress: string;

        if (existingUser) {
            // Use existing wallet
            walletAddress = existingUser.walletAddress || 'Not set';
        } else {
            // Create new user
            await userStore.saveUser(userId, {
                telegramId: msg.from.id,
                preferences: {
                    notifications: true,
                    language: 'en'
                }
            });

            // Generate new wallet
            const wallet = new Wallet();
            await wallet.connect();
            walletAddress = wallet.getAddress();
            const privateKey = wallet.getPrivateKey();

            // Encrypt private key
            const encryptedPrivateKey = encrypt(privateKey);

            // Update user with wallet info
            await userStore.updateWallet(userId, walletAddress, encryptedPrivateKey);
        }

        // Inline keyboard buttons
        const keyboard = {
            inline_keyboard: [
                [
                    { text: 'Export private key', callback_data: 'export_private_key' },
                    { text: 'View on Solscan', url: `https://solscan.io/account/${walletAddress}` }
                ],
                [
                    { text: 'Close', callback_data: 'close_wallet_info' },
                    { text: 'Refresh', callback_data: 'refresh_wallet_info' }
                ]
            ]
        };

        // Send welcome message with wallet info and buttons
        await bot.sendMessage(
            chatId,
            `Welcome ${userName}! 👋\n\n` +
            `Your Solana wallet:\n` +
            `Address: \`${walletAddress}\`\n\n` +
            `Use /wallet to manage your wallet.\n`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );

    } catch (error) {
        console.error('Error in start command:', error);
        await bot.sendMessage(
            chatId,
            '❌ Sorry, something went wrong while setting up your account. Please try again later.'
        );
    }
} 