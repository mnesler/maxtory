// Passport OAuth strategies for Google and GitHub

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { findOrCreateUser, type User } from "./db.js";

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback";

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL || "http://localhost:3000/auth/github/callback";

/**
 * Configure Google OAuth strategy
 */
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ["profile", "email"],
      },
      (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || `${profile.id}@google.com`;
          const name = profile.displayName || email;
          const avatar = profile.photos?.[0]?.value;

          const user = findOrCreateUser({
            email,
            name,
            avatar,
            provider: "google",
            providerId: profile.id,
          });

          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}

/**
 * Configure GitHub OAuth strategy
 */
if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        callbackURL: GITHUB_CALLBACK_URL,
        scope: ["user:email"],
      },
      (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
        try {
          const email = profile.emails?.[0]?.value || `${profile.username}@github.com`;
          const name = profile.displayName || profile.username || email;
          const avatar = profile.photos?.[0]?.value || profile._json?.avatar_url;

          const user = findOrCreateUser({
            email,
            name,
            avatar,
            provider: "github",
            providerId: profile.id,
          });

          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}

// Passport serialization (not used with JWT, but required for passport)
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser((id: number, done) => {
  // Not used with JWT, but required
  done(null, { id });
});

export default passport;
