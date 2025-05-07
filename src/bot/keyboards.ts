import { InlineKeyboardMarkup } from 'node-telegram-bot-api';

/**
 * Generates the inline keyboard for wallet-related messages.
 *
 * @param walletAddress The user's Solana wallet address.
 * @returns An InlineKeyboardMarkup object.
 */
export const getWalletKeyboard = (walletAddress: string): InlineKeyboardMarkup => {
    return {
        inline_keyboard: [
            [
                { text: '📋 Export Private Key', callback_data: 'export_private_key' },
                { text: '🔍 View on Solscan', url: `https://solscan.io/account/${walletAddress}?cluster=devnet` } // Assuming devnet for now
            ],
            [
                { text: '🔄 Refresh', callback_data: 'refresh_wallet_info' },
                { text: '❌ Close', callback_data: 'close_wallet_info' }
            ]
        ]
    };
}; 