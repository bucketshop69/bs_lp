interface UserPreferences {
    notifications: boolean;
    language: string;
    // Add more preferences as needed
}

interface UserData {
    id: string;
    telegramId: number;
    walletAddress?: string;
    encryptedPrivateKey?: string;
    preferences: UserPreferences;
    createdAt: Date;
    lastActive: Date;
}

export class UserStore {
    private users: Map<string, UserData> = new Map();

    constructor() {
        // Initialize user store
        console.log('UserStore initialized');
    }

    /**
     * Creates a new user or updates an existing one
     */
    public async saveUser(userId: string, data: Partial<UserData>): Promise<UserData> {
        const existingUser = this.users.get(userId);
        const now = new Date();

        const userData: UserData = {
            id: userId,
            telegramId: data.telegramId || existingUser?.telegramId || 0,
            walletAddress: data.walletAddress || existingUser?.walletAddress,
            encryptedPrivateKey: data.encryptedPrivateKey || existingUser?.encryptedPrivateKey,
            preferences: {
                notifications: data.preferences?.notifications ?? existingUser?.preferences?.notifications ?? true,
                language: data.preferences?.language || existingUser?.preferences?.language || 'en',
            },
            createdAt: existingUser?.createdAt || now,
            lastActive: now,
        };

        this.users.set(userId, userData);
        return userData;
    }

    /**
     * Retrieves a user by their ID
     */
    public async getUser(userId: string): Promise<UserData | undefined> {
        const user = this.users.get(userId);
        if (user) {
            // Update last active timestamp
            user.lastActive = new Date();
            this.users.set(userId, user);
        }
        return user;
    }

    /**
     * Deletes a user from the store
     */
    public async deleteUser(userId: string): Promise<boolean> {
        return this.users.delete(userId);
    }

    /**
     * Updates user preferences
     */
    public async updatePreferences(userId: string, preferences: Partial<UserPreferences>): Promise<UserData | undefined> {
        const user = await this.getUser(userId);
        if (!user) return undefined;

        const updatedUser = await this.saveUser(userId, {
            ...user,
            preferences: {
                ...user.preferences,
                ...preferences,
            },
        });

        return updatedUser;
    }

    /**
     * Updates wallet information
     */
    public async updateWallet(userId: string, walletAddress: string, encryptedPrivateKey: string): Promise<UserData | undefined> {
        const user = await this.getUser(userId);
        if (!user) return undefined;

        const updatedUser = await this.saveUser(userId, {
            ...user,
            walletAddress,
            encryptedPrivateKey,
        });

        return updatedUser;
    }

    /**
     * Gets all users (useful for debugging or admin purposes)
     */
    public async getAllUsers(): Promise<UserData[]> {
        return Array.from(this.users.values());
    }

    /**
     * Checks if a user exists
     */
    public async userExists(userId: string): Promise<boolean> {
        return this.users.has(userId);
    }
}
