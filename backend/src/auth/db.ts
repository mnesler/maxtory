// User database using SQLite

import Database from "better-sqlite3";
import { join } from "path";

const DB_PATH = process.env.AUTH_DB_PATH || join(process.cwd(), "users.db");

export interface User {
  id: number;
  email: string;
  name: string;
  avatar?: string;
  provider: "google" | "github";
  providerId: string;
  createdAt: string;
  lastLogin: string;
}

export interface UserInput {
  email: string;
  name: string;
  avatar?: string;
  provider: "google" | "github";
  providerId: string;
}

// Initialize the database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,
    provider TEXT NOT NULL,
    providerId TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    lastLogin TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, providerId)
  )
`);

const findUserByProviderId = db.prepare<[string, string]>(
  "SELECT * FROM users WHERE provider = ? AND providerId = ?"
);

const insertUser = db.prepare<UserInput>(
  `INSERT INTO users (email, name, avatar, provider, providerId)
   VALUES (@email, @name, @avatar, @provider, @providerId)`
);

const updateLastLogin = db.prepare<[number]>(
  "UPDATE users SET lastLogin = CURRENT_TIMESTAMP WHERE id = ?"
);

const findUserById = db.prepare<[number]>("SELECT * FROM users WHERE id = ?");

/**
 * Find or create a user from OAuth profile
 */
export function findOrCreateUser(input: UserInput): User {
  // Try to find existing user
  const existing = findUserByProviderId.get(input.provider, input.providerId) as User | undefined;

  if (existing) {
    // Update last login
    updateLastLogin.run(existing.id);
    return { ...existing, lastLogin: new Date().toISOString() };
  }

  // Create new user
  const result = insertUser.run(input);
  const newUser = findUserById.get(result.lastInsertRowid as number) as User;
  return newUser;
}

/**
 * Get user by ID
 */
export function getUserById(id: number): User | undefined {
  return findUserById.get(id) as User | undefined;
}

/**
 * Close the database connection (for cleanup)
 */
export function closeDb() {
  db.close();
}
