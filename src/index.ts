// src/index.ts
import dotenv from 'dotenv';
import { initializeBot } from './bot/bot';
import { loadConfig } from './config'; // Optional config loader

// Load environment variables from .env file
dotenv.config();

console.log('Starting LP Bot...');

// Load configuration
const config = loadConfig();

// Initialize and start the Telegram bot
initializeBot(config.telegramBotToken);

console.log('Bot initialization sequence complete.');

// Basic error handling for uncaught exceptions or promise rejections
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Consider graceful shutdown here
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Consider graceful shutdown here
});