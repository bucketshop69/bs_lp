import TelegramBot from 'node-telegram-bot-api';
import { Connection } from '@solana/web3.js';
import { swap } from '../../services/jupService';
import { getTokenBalance } from '../../solana/utils';
import { getUserKeypair } from '../../services/getUserWallet';

const connection = new Connection('https://api.mainnet-beta.solana.com');

export async function handleSwapCommand(bot: TelegramBot, msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();

    if (!userId) {
        await bot.sendMessage(chatId, '❌ Could not identify user.');
        return;
    }

    try {
        // Get user's keypair using the getUserKeypair function
        const keypair = await getUserKeypair(userId);

        // Get SOL balance
        const solBalance = await getTokenBalance(
            keypair.publicKey.toString(),
            'So11111111111111111111111111111111111111112' // SOL mint address
        );

        // Example swap: SOL to USDC
        const signature = await swap({
            inputMint: 'So11111111111111111111111111111111111111112', // SOL
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            amount: '1000000', // 0.001 SOL
            slippageBps: 50,
            prioritizationFeeLamports: {
                maxLamports: 1000000,
                priorityLevel: "veryHigh"
            }
        }, keypair, connection);

        await bot.sendMessage(
            chatId,
            `✅ Swap completed successfully!\n\nTransaction: https://solscan.io/tx/${signature}`
        );

    } catch (error) {
        console.error('Swap command error:', error);
        await bot.sendMessage(
            chatId,
            `❌ Failed to execute swap: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
} 