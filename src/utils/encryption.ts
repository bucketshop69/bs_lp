import crypto from 'crypto';
import { loadConfig } from '../config';

// Get encryption key from config
const { encryptionKey } = loadConfig();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Create a 32-byte key from the encryption key string
const key = crypto.scryptSync(encryptionKey, 'salt', 32);

/**
 * Encrypts data using AES-256-GCM.
 * @param data The string data to encrypt.
 * @returns A string containing iv:encryptedData:authTag, encoded in hex.
 */
export function encrypt(data: string): string {
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        // Combine IV, encrypted data, and auth tag, then encode as hex
        return Buffer.concat([iv, encrypted, authTag]).toString('hex');
    } catch (error) {
        console.error('Encryption failed:', error);
        throw new Error('Encryption process failed.');
    }
}

/**
 * Decrypts data encrypted with AES-256-GCM.
 * @param encryptedDataHex A hex string containing iv:encryptedData:authTag.
 * @returns The original decrypted string.
 */
export function decrypt(encryptedDataHex: string): string {
    try {
        const encryptedBuffer = Buffer.from(encryptedDataHex, 'hex');

        // Extract IV, encrypted data, and auth tag
        const iv = encryptedBuffer.subarray(0, IV_LENGTH);
        const encrypted = encryptedBuffer.subarray(IV_LENGTH, encryptedBuffer.length - AUTH_TAG_LENGTH);
        const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (error) {
        console.error('Decryption failed:', error);
        throw new Error('Decryption process failed. Ensure data and key are correct.');
    }
}

/**
 * Generates a new encryption key.
 * @returns A random string suitable for use as an encryption key.
 */
export function generateKey(): string {
    return crypto.randomBytes(32).toString('base64');
}
