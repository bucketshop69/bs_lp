import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(__dirname, '../../data/lp_bot.db');
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER,
  wallet_address TEXT,
  encrypted_private_key TEXT,
  preferences TEXT,
  created_at DATETIME,
  last_active DATETIME
);
`);

type UserRow = {
    id: string;
    telegram_id: number;
    wallet_address: string;
    encrypted_private_key: string;
    preferences: string;
    created_at: string;
    last_active: string;
};

export interface UserPreferences {
    notifications: boolean;
    language: string;
}

export interface UserData {
    id: string;
    telegramId: number;
    walletAddress?: string;
    encryptedPrivateKey?: string;
    preferences: UserPreferences;
    createdAt: Date;
    lastActive: Date;
}

export class SqliteUserStore {
    constructor() {
        // Table is created on module load
    }

    public saveUser(userId: string, data: Partial<UserData>): UserData {
        const now = new Date();
        const existing = this.getUser(userId);
        const user: UserData = {
            id: userId,
            telegramId: data.telegramId || existing?.telegramId || 0,
            walletAddress: data.walletAddress || existing?.walletAddress,
            encryptedPrivateKey: data.encryptedPrivateKey || existing?.encryptedPrivateKey,
            preferences: data.preferences || existing?.preferences || { notifications: true, language: 'en' },
            createdAt: existing?.createdAt || now,
            lastActive: now,
        };
        db.prepare(`REPLACE INTO users (id, telegram_id, wallet_address, encrypted_private_key, preferences, created_at, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
            user.id,
            user.telegramId,
            user.walletAddress,
            user.encryptedPrivateKey,
            JSON.stringify(user.preferences),
            user.createdAt.toISOString(),
            user.lastActive.toISOString()
        );
        return user;
    }

    public getUser(userId: string): UserData | undefined {
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
        if (!row) return undefined;
        return {
            id: row.id,
            telegramId: row.telegram_id,
            walletAddress: row.wallet_address,
            encryptedPrivateKey: row.encrypted_private_key,
            preferences: JSON.parse(row.preferences),
            createdAt: new Date(row.created_at),
            lastActive: new Date(row.last_active),
        };
    }

    public deleteUser(userId: string): boolean {
        const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        return result.changes > 0;
    }

    public updatePreferences(userId: string, preferences: Partial<UserPreferences>): UserData | undefined {
        const user = this.getUser(userId);
        if (!user) return undefined;
        const updatedPrefs = { ...user.preferences, ...preferences };
        return this.saveUser(userId, { ...user, preferences: updatedPrefs });
    }

    public updateWallet(userId: string, walletAddress: string, encryptedPrivateKey: string): UserData | undefined {
        const user = this.getUser(userId);
        if (!user) return undefined;
        return this.saveUser(userId, { ...user, walletAddress, encryptedPrivateKey });
    }

    public getAllUsers(): UserData[] {
        const rows = db.prepare('SELECT * FROM users').all() as UserRow[];
        return rows.map(row => ({
            id: row.id,
            telegramId: row.telegram_id,
            walletAddress: row.wallet_address,
            encryptedPrivateKey: row.encrypted_private_key,
            preferences: JSON.parse(row.preferences),
            createdAt: new Date(row.created_at),
            lastActive: new Date(row.last_active),
        }));
    }

    public userExists(userId: string): boolean {
        return !!this.getUser(userId);
    }
} 