// JWT utilities for signing and verifying tokens

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_ACCESS_EXPIRY = "7d"; // 7 days
const JWT_REFRESH_EXPIRY = "30d"; // 30 days

export interface JWTPayload {
  userId: number;
  email: string;
  name: string;
  avatar?: string;
  type: "access" | "refresh";
}

/**
 * Sign a JWT access token (7 day expiry)
 */
export function signAccessToken(payload: Omit<JWTPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
  });
}

/**
 * Sign a JWT refresh token (30 day expiry)
 */
export function signRefreshToken(payload: Omit<JWTPayload, "type">): string {
  return jwt.sign({ ...payload, type: "refresh" }, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRY,
  });
}

/**
 * Verify a JWT token and return the payload
 */
export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (err) {
    throw new Error(`Invalid token: ${err}`);
  }
}

/**
 * Decode a JWT without verifying (useful for debugging)
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
}
