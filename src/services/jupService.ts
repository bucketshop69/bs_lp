import axios from 'axios';
import { Connection, VersionedTransaction, Keypair } from '@solana/web3.js';
import { getUserKeypair } from './getUserWallet';
import { getTokenBalance } from '../solana/utils';

interface JupiterQuoteParams {
    inputMint: string;
    outputMint: string;
    amount: string | number;
    slippageBps: number;
    restrictIntermediateTokens?: boolean;
}

interface JupiterQuoteResponse {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee: null | any;
    priceImpactPct: string;
    routePlan: Array<{
        swapInfo: {
            ammKey: string;
            label: string;
            inputMint: string;
            outputMint: string;
            inAmount: string;
            outAmount: string;
            feeAmount: string;
            feeMint: string;
        };
        percent: number;
    }>;
    contextSlot: number;
    timeTaken: number;
}

interface JupiterSwapParams {
    quoteResponse: JupiterQuoteResponse;
    userPublicKey: string;
    dynamicComputeUnitLimit?: boolean;
    dynamicSlippage?: boolean;
    prioritizationFeeLamports?: {
        priorityLevelWithMaxLamports: {
            maxLamports: number;
            priorityLevel: "low" | "medium" | "high" | "veryHigh";
        }
    };
}

interface JupiterSwapResponse {
    swapTransaction: string;
}

interface SwapParams {
    inputMint: string;
    outputMint: string;
    amount: string | number;
    slippageBps?: number;
    restrictIntermediateTokens?: boolean;
    prioritizationFeeLamports?: {
        maxLamports: number;
        priorityLevel: "low" | "medium" | "high" | "veryHigh";
    };
}

export async function getJupiterSwapQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResponse> {
    try {
        const { inputMint, outputMint, amount, slippageBps, restrictIntermediateTokens = true } = params;

        const url = 'https://lite-api.jup.ag/swap/v1/quote';
        const response = await axios.get(url, {
            params: {
                inputMint,
                outputMint,
                amount,
                slippageBps,
                restrictIntermediateTokens
            }
        });

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('Jupiter API error:', error.response?.data || error.message);
            throw new Error(`Jupiter API error: ${error.message}`);
        } else {
            console.error('Jupiter quote error:', error);
            throw new Error('Failed to get Jupiter swap quote');
        }
    }
}

export async function executeJupiterSwap(
    params: JupiterSwapParams,
    signer: Keypair,
    connection: Connection
): Promise<string> {
    try {
        // Check balance before proceeding
        const balance = await connection.getBalance(signer.publicKey);
        const requiredAmount = BigInt(params.quoteResponse.inAmount);

        if (BigInt(balance) < requiredAmount) {
            throw new Error(`Insufficient balance. Required: ${requiredAmount} lamports, Available: ${balance} lamports`);
        }

        // 1. Get the swap transaction from Jupiter API
        const swapResponse = await axios.post<JupiterSwapResponse>(
            'https://lite-api.jup.ag/swap/v1/swap',
            params,
            {
                headers: {
                    'Content-Type': 'application/json',
                }
            }
        );

        // 2. Extract and deserialize the transaction
        const transactionBase64 = swapResponse.data.swapTransaction;
        const transaction = VersionedTransaction.deserialize(
            Buffer.from(transactionBase64, 'base64')
        );

        // 3. Sign the transaction
        transaction.sign([signer]);

        // 4. Serialize the transaction
        const transactionBinary = transaction.serialize();

        // 5. Send the transaction
        const signature = await connection.sendRawTransaction(transactionBinary, {
            maxRetries: 2,
            skipPreflight: true
        });

        return signature;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('Jupiter Swap API error:', error.response?.data || error.message);
            throw new Error(`Jupiter Swap API error: ${error.message}`);
        } else if (error instanceof Error) {
            console.error('Swap execution error:', error.message);
            throw error;
        } else {
            console.error('Jupiter swap execution error:', error);
            throw new Error('Failed to execute Jupiter swap');
        }
    }
}

/**
 * Executes a token swap using Jupiter
 * @param params Swap parameters including input/output tokens and amount
 * @param signer The keypair that will sign the transaction
 * @param connection A Solana connection instance
 * @returns The transaction signature
 */
export async function swap(
    params: SwapParams,
    signer: Keypair,
    connection: Connection
): Promise<string> {
    try {
        console.log('Starting swap process...');

        // 1. Get token balance for input token
        const inputTokenBalance = await getTokenBalance(
            signer.publicKey.toString(),
            params.inputMint
        );

        console.log('Input token balance:', {
            symbol: inputTokenBalance.tokenInfo.symbol,
            balance: inputTokenBalance.balance,
            rawAmount: inputTokenBalance.rawAmount
        });

        // 2. Get quote
        const quoteResponse = await getJupiterSwapQuote({
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            slippageBps: params.slippageBps || 50,
            restrictIntermediateTokens: params.restrictIntermediateTokens ?? true
        });

        console.log('Swap quote received:', {
            inputAmount: quoteResponse.inAmount,
            outputAmount: quoteResponse.outAmount,
            priceImpact: quoteResponse.priceImpactPct
        });

        // 3. Execute swap
        const signature = await executeJupiterSwap(
            {
                quoteResponse,
                userPublicKey: signer.publicKey.toString(),
                dynamicComputeUnitLimit: true,
                dynamicSlippage: true,
                prioritizationFeeLamports: params.prioritizationFeeLamports ? {
                    priorityLevelWithMaxLamports: {
                        maxLamports: params.prioritizationFeeLamports.maxLamports,
                        priorityLevel: params.prioritizationFeeLamports.priorityLevel
                    }
                } : undefined
            },
            signer,
            connection
        );

        // 4. Get final balance
        const finalBalance = await getTokenBalance(
            signer.publicKey.toString(),
            params.outputMint
        );

        console.log('Swap completed successfully!');
        console.log('Final output token balance:', {
            symbol: finalBalance.tokenInfo.symbol,
            balance: finalBalance.balance,
            rawAmount: finalBalance.rawAmount
        });

        return signature;
    } catch (error) {
        console.error('Swap failed:', error);
        throw error;
    }
}

// Example usage:
// const keypair = await getUserKeypair('7883754831');
// const connection = new Connection('https://api.mainnet-beta.solana.com');
// 
// const signature = await swap({
//     inputMint: 'So11111111111111111111111111111111111111112', // SOL
//     outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
//     amount: '1000000', // 0.001 SOL
//     slippageBps: 50,
//     prioritizationFeeLamports: {
//         maxLamports: 1000000,
//         priorityLevel: "veryHigh"
//     }
// }, keypair, connection);
// 
// console.log(`Swap completed! Transaction: https://solscan.io/tx/${signature}`);
