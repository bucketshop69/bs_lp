import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

import axios from 'axios';

// Assuming SOLANA_RPC_ENDPOINT is set in your environment variables
// You might want to replace the fallback with a more robust configuration solution
const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';

interface TokenInfo {
    address: string;
    chainId: number;
    decimals: number;
    name: string;
    symbol: string;
    logoURI?: string;
}

interface TokenBalance {
    balance: number;        // Human-readable balance
    rawAmount: number;      // Raw amount (multiplied by 10^decimals)
    tokenInfo: TokenInfo;
}

/**
 * Fetches the SOL balance for a given public key string.
 *
 * @param publicKeyString The public key address as a string.
 * @returns A promise that resolves to the SOL balance, or 0 if an error occurs.
 */
export async function getSolBalance(publicKeyString: string): Promise<number> {
    const connection = new Connection(SOLANA_RPC_ENDPOINT);
    try {
        const publicKey = new PublicKey(publicKeyString);
        const lamports = await connection.getBalance(publicKey);
        const sol = lamports / LAMPORTS_PER_SOL;
        console.log(`Balance for ${publicKeyString}: ${sol} SOL`); // Added logging
        return sol;
    } catch (error) {
        console.error(`Error fetching balance for ${publicKeyString}:`, error);
        // Depending on requirements, you might want to throw a custom error instead
        return 0;
    }
}

/**
 * Fetches token balance and information for a given token mint and wallet address
 * @param walletAddress The wallet address to check balance for
 * @param tokenMint The token mint address
 * @returns Promise containing the token balance and token information
 */
export async function getTokenBalance(
    walletAddress: string,
    tokenMint: string
): Promise<TokenBalance> {
    const connection = new Connection(SOLANA_RPC_ENDPOINT);

    try {
        // 1. Get token info from Jupiter API
        const tokenInfoResponse = await axios.get<TokenInfo>(
            `https://lite-api.jup.ag/tokens/v1/token/${tokenMint}`
        );
        const tokenInfo = tokenInfoResponse.data;

        // 2. Get token account
        const walletPublicKey = new PublicKey(walletAddress);
        const mintPublicKey = new PublicKey(tokenMint);

        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            walletPublicKey,
            { mint: mintPublicKey }
        );

        // 3. Calculate balance
        let balance = 0;
        let rawAmount = 0;
        if (tokenAccounts.value.length > 0) {
            const tokenAccount = tokenAccounts.value[0];
            const parsedInfo = tokenAccount.account.data.parsed.info;
            balance = Number(parsedInfo.tokenAmount.uiAmount);
            rawAmount = Number(parsedInfo.tokenAmount.amount);
        }

        console.log(`Token Balance for ${walletAddress}:`, {
            symbol: tokenInfo.symbol,
            balance: balance,
            rawAmount: rawAmount,
            decimals: tokenInfo.decimals,
            name: tokenInfo.name
        });

        return {
            balance,
            rawAmount,
            tokenInfo
        };
    } catch (error) {
        console.error(`Error fetching token balance for ${tokenMint}:`, error);
        throw new Error(`Failed to fetch token balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// Example usage:
// const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// const walletAddress = '4VNudN9D33nf6wXHpYbwiQkJPXSyFJ9VamA2GbzLD6d8';
// const balance = await getTokenBalance(walletAddress, usdcMint);
// console.log(`USDC Balance: ${balance.balance} ${balance.tokenInfo.symbol} (Raw: ${balance.rawAmount})`); 