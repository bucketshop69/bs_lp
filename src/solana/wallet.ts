import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export class Wallet {
    private keypair: Keypair;

    constructor() {
        this.keypair = Keypair.generate();
    }

    public async connect(): Promise<void> {
        // No-op for local wallet generation
    }

    public async disconnect(): Promise<void> {
        // No-op for local wallet
    }

    public getAddress(): string {
        return this.keypair.publicKey.toBase58();
    }

    public getPrivateKey(): string {
        // Return the private key as a base58-encoded string
        return bs58.encode(this.keypair.secretKey);
    }
}
