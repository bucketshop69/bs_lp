#!/bin/bash
# Script to build and run the Docker container locally

echo "Building Docker container..."
docker build -t bs-lp-bot .

echo "Running Docker container..."
docker run -it --rm \
  -p 3000:3000 \
  -e TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN}" \
  -e ENCRYPTION_KEY="${ENCRYPTION_KEY}" \
  -e SOLANA_NETWORK="${SOLANA_NETWORK:-mainnet-beta}" \
  -v "$(pwd)/data:/app/data" \
  bs-lp-bot

echo "Container exited." 