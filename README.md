# 🚀 Solana Liquidity Provider Bot

> A powerful, automated liquidity provider bot for Solana DEXes with real-time monitoring and control via Telegram.

## 📋 Overview

This project implements an advanced automated liquidity provider bot that interacts with Solana DEXes (specifically Raydium) to provide liquidity and manage positions. The bot features a Telegram interface for real-time monitoring and control, making it easy to manage your liquidity positions from anywhere.

### 🌟 Key Features

- **Automated Liquidity Management**
  - Smart position sizing and rebalancing
  - Real-time market analysis
  - Automated entry and exit strategies
  - Risk management controls

- **Telegram Integration**
  - Real-time position monitoring
  - Instant notifications for important events
  - Interactive commands for bot control
  - Customizable alerts and reports

- **Advanced Trading Features**
  - Raydium DEX integration
  - Multiple pool support
  - Configurable trading parameters
  - Position tracking and analytics

- **Security & Reliability**
  - Secure private key management
  - Transaction verification
  - Error handling and recovery
  - Persistent storage with SQLite

## 🏗️ Project Structure

```
src/
├── bot/           # Telegram bot implementation
│   ├── commands/  # Bot command handlers
│   └── handlers/  # Message and event handlers
├── services/      # Core business logic
│   ├── trading/   # Trading strategies
│   └── analysis/  # Market analysis
├── solana/        # Blockchain interaction
│   ├── wallet/    # Wallet management
│   └── dex/       # DEX integration
├── storage/       # Database and storage
├── config/        # Configuration management
└── utils/         # Helper functions
```

## ⚙️ Prerequisites

Before you begin, ensure you have the following:

- **Node.js Environment**
  - Node.js v16 or higher
  - npm v7 or higher
  - TypeScript v5.3 or higher

- **Solana Setup**
  - Solana CLI tools installed
  - A funded Solana wallet
  - Access to Solana mainnet or devnet

- **Telegram Setup**
  - Telegram Bot Token (from @BotFather)
  - Telegram account for bot interaction

- **Development Tools**
  - Git
  - Code editor (VS Code recommended)
  - Terminal with shell access

## 🚀 Getting Started

### 1. Installation

```bash
# Clone the repository
git clone <repository-url>
cd bs_lp

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

### 2. Configuration

Create a `.env` file with the following variables:

```env
# Solana Configuration
SOLANA_PRIVATE_KEY=your_private_key
SOLANA_NETWORK=mainnet-beta  # or devnet

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Trading Configuration
MIN_LIQUIDITY_AMOUNT=1000
MAX_SLIPPAGE=0.5
```

### 3. Running the Bot

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm start
```

## 💻 Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build production version
- `npm start` - Run production build
- `npm run lint` - Run linter
- `npm run format` - Format code

### Code Style

- Follow TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper error handling
- Add comments for complex logic

## 🔧 Dependencies

### Core Dependencies
- `@project-serum/anchor` - Solana smart contract interaction
- `@raydium-io/raydium-sdk` - Raydium DEX integration
- `@solana/web3.js` - Solana blockchain interaction
- `node-telegram-bot-api` - Telegram bot functionality
- `better-sqlite3` - Local database storage

### Development Dependencies
- `typescript` - TypeScript support
- `nodemon` - Development server
- `rimraf` - Cross-platform file deletion
- `ts-node` - TypeScript execution

## 📊 Monitoring & Analytics

The bot provides comprehensive monitoring through:

- Real-time position tracking
- Performance analytics
- Risk metrics
- Transaction history
- Custom alerts and notifications

## 🔐 Security Considerations

- Never share your private keys
- Use environment variables for sensitive data
- Implement proper error handling
- Regular security audits
- Backup your database regularly

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📝 License

This project is licensed under the ISC License - see the LICENSE file for details.

## ⚠️ Disclaimer

This software is for educational purposes only. Use at your own risk. The authors are not responsible for any financial losses incurred through the use of this software.
