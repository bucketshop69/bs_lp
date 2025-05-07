import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { SqliteUserStore } from '../storage/sqliteUserStore';
import { decrypt } from '../utils/encryption';
import { loadConfig } from '../config';

const userStore = new SqliteUserStore();

/**
 * Retrieves a user's keypair for transaction signing.
 * @param userId The user's ID
 * @returns The user's Keypair object for transaction signing
 * @throws Error if user not found or if keypair cannot be retrieved
 */
export async function getUserKeypair(userId: string): Promise<Keypair> {
    // Verify encryption key is set
    const { encryptionKey } = loadConfig();
    if (!encryptionKey) {
        throw new Error('Encryption key is not configured');
    }

    // Get user data from store
    const user = userStore.getUser(userId);
    if (!user) {
        throw new Error('User not found');
    }

    // Check if user has a wallet
    if (!user.encryptedPrivateKey) {
        throw new Error('User has no wallet set up');
    }

    try {
        // Decrypt the private key
        const decryptedPrivateKey = decrypt(user.encryptedPrivateKey);

        // Convert base58 private key to Uint8Array
        const privateKeyBytes = bs58.decode(decryptedPrivateKey);

        // Create and return the keypair
        return Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
        console.error('Error retrieving user keypair for user:', userId);
        throw new Error('Failed to retrieve user keypair. Please ensure the encryption key is correct.');
    }
}
