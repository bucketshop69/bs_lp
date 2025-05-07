import dotenv from 'dotenv';

// Ensure environment variables are loaded
// This might be redundant if already called in src/index.ts, but ensures config works independently
dotenv.config();

interface Config {
    telegramBotToken: string;
    encryptionKey: string;
    solanaRpcEndpoint: string; // Added SOLANA_RPC_ENDPOINT
    // Add other config options as needed
}

export function loadConfig(): Config {
    const telegramBotToken = process.env.BS_LP_TELEGRAM_BOT_TOKEN;
    const encryptionKey = process.env.ENCRYPTION_KEY;
    // Also load the RPC endpoint, providing a default if not set
    const solanaRpcEndpoint = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';

    if (!telegramBotToken) {
        throw new Error('Missing required environment variable: TELEGRAM_BOT_TOKEN');
    }

    if (!encryptionKey) {
        throw new Error('Missing required environment variable: ENCRYPTION_KEY');
    }


    return {
        telegramBotToken,
        encryptionKey,
        solanaRpcEndpoint,
    };
}
