// Authentication middleware for protected routes

import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt.js";
import { getUserById } from "./db.js";

// Extend Express Request to include authenticated user
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  avatar?: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

/**
 * Middleware to require authentication via JWT
 * Checks Authorization header (Bearer token) or auth_token cookie
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Try to get token from Authorization header
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.cookies?.auth_token) {
      // Fallback to cookie
      token = req.cookies.auth_token;
    }

    if (!token) {
      return res.status(401).json({ error: "No authentication token provided" });
    }

    // Verify token
    const payload = verifyToken(token);

    // Check that it's an access token (not refresh)
    if (payload.type !== "access") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    // Get user from database
    const user = getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Attach user to request
    req.authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Optional auth - attach user if token is present, but don't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.cookies?.auth_token) {
      token = req.cookies.auth_token;
    }

    if (token) {
      const payload = verifyToken(token);
      if (payload.type === "access") {
        const user = getUserById(payload.userId);
        if (user) {
          req.authUser = {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
          };
        }
      }
    }
  } catch {
    // Ignore errors, auth is optional
  }

  next();
}
