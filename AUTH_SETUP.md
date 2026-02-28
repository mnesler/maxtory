# OAuth Authentication Setup Guide

This guide explains how to set up Google and GitHub OAuth authentication for the Rhystic Study MTG Deck Advisor.

## Overview

The application now features:
- **Glitchy Industrial Landing Page** with CRT effects, scanlines, and cyberpunk aesthetics
- **Google OAuth** authentication
- **GitHub OAuth** authentication  
- **JWT-based** session management with access and refresh tokens
- **Protected routes** requiring authentication
- **User database** (SQLite) for persisting user accounts

## Quick Start

### 1. Set Up OAuth Credentials

#### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. Select **Web application**
6. Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
7. Copy the **Client ID** and **Client Secret**

#### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: Rhystic Study (or your choice)
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:3000/auth/github/callback`
4. Click **Register application**
5. Copy the **Client ID** and generate a **Client Secret**

### 2. Configure Environment Variables

Copy the `.env.example` file to `.env` in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and add your OAuth credentials:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your_actual_google_client_id
GOOGLE_CLIENT_SECRET=your_actual_google_client_secret

# GitHub OAuth
GITHUB_CLIENT_ID=your_actual_github_client_id
GITHUB_CLIENT_SECRET=your_actual_github_client_secret

# JWT Secret (generate a random 32+ character string)
JWT_SECRET=your_random_secret_key_min_32_chars
```

**IMPORTANT:** Never commit your `.env` file to version control! It's already in `.gitignore`.

### 3. Install Dependencies

From the monorepo root:

```bash
npm install
```

This will install dependencies for all workspaces, including the new auth packages.

### 4. Start the Backend

```bash
cd backend
npm run dev
```

The backend API will start on `http://localhost:3000` with OAuth routes enabled.

### 5. Start the MTG Frontend

In a new terminal:

```bash
cd mtg/frontend
npm run dev
```

The frontend will start on `http://localhost:5173` and show the glitchy landing page.

### 6. Test the Authentication Flow

1. Visit `http://localhost:5173`
2. You should see the **RHYSTIC STUDY** landing page with glitchy effects
3. Click **"AUTHENTICATE WITH GOOGLE"** or **"AUTHENTICATE WITH GITHUB"**
4. Complete the OAuth flow in the popup/redirect
5. You'll be redirected back to `/auth` with a token, then to `/app`
6. The MTG Deck Advisor interface will load with your user info in the header

## Architecture

### Backend (Express)

- **`/backend/src/auth/db.ts`** - SQLite database for user storage
- **`/backend/src/auth/jwt.ts`** - JWT signing and verification utilities
- **`/backend/src/auth/strategies.ts`** - Passport Google & GitHub OAuth strategies
- **`/backend/src/auth/middleware.ts`** - Auth middleware for protected routes
- **`/backend/src/api/server.ts`** - OAuth routes and token endpoints

#### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/google` | Initiate Google OAuth flow |
| GET | `/auth/google/callback` | Google OAuth callback |
| GET | `/auth/github` | Initiate GitHub OAuth flow |
| GET | `/auth/github/callback` | GitHub OAuth callback |
| GET | `/auth/me` | Get current user (requires JWT) |
| POST | `/auth/refresh` | Refresh access token using refresh token |
| POST | `/auth/logout` | Clear refresh token cookie |

### Frontend (SolidJS)

- **`/mtg/frontend/src/pages/Landing.tsx`** - Glitchy landing page with OAuth buttons
- **`/mtg/frontend/src/pages/Auth.tsx`** - OAuth callback handler
- **`/mtg/frontend/src/context/AuthContext.tsx`** - Global auth state management
- **`/mtg/frontend/src/components/ProtectedRoute.tsx`** - Route guard for authenticated routes
- **`/mtg/frontend/src/components/GlitchyButton.tsx`** - Cyberpunk-styled OAuth buttons
- **`/mtg/frontend/src/styles/glitch.css`** - Glitchy/industrial CSS effects

#### Routes

| Path | Component | Protection |
|------|-----------|-----------|
| `/` | Landing | Public |
| `/auth` | Auth (callback handler) | Public |
| `/app` | App (MTG Advisor) | Protected |

## Glitchy UI Features

The landing page includes:
- **CRT Screen Effects**: Scanlines, vignette, and curvature
- **RGB Split**: Chromatic aberration on title text
- **Noise Overlay**: Animated static/grain
- **Printer Marks**: CMYK calibration marks in corners
- **VHS Distortion**: Subtle horizontal displacement
- **Terminal Cursor**: Blinking cursor animation
- **Data Rain**: Matrix-style background effect
- **Hologram Shimmer**: Color-shifting gradients on buttons
- **Glitch Animations**: Random skew and transform on hover

All effects are GPU-accelerated using CSS transforms and opacity for smooth 60fps performance.

## Token Management

### Access Tokens
- **Validity**: 7 days
- **Storage**: localStorage (`auth_token`)
- **Usage**: Sent in `Authorization: Bearer <token>` header

### Refresh Tokens
- **Validity**: 30 days
- **Storage**: httpOnly cookie (more secure)
- **Usage**: Automatically sent with requests to `/auth/refresh`

### Token Refresh Flow

When an access token expires, the frontend can request a new one:

```typescript
const response = await fetch('http://localhost:3000/auth/refresh', {
  method: 'POST',
  credentials: 'include', // Send cookies
});
const { accessToken } = await response.json();
localStorage.setItem('auth_token', accessToken);
```

## Database

User data is stored in SQLite at `./users.db` (or path specified by `AUTH_DB_PATH` env var).

### Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  provider TEXT NOT NULL,  -- 'google' or 'github'
  providerId TEXT NOT NULL,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  lastLogin TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, providerId)
);
```

## Security Considerations

### Development vs. Production

**Development** (current setup):
- Uses `http://localhost` URLs
- Cookies have `secure: false` (allows http)

**Production** (recommended changes):
1. Update callback URLs to use HTTPS
2. Set `NODE_ENV=production` to enable secure cookies
3. Use a strong random `JWT_SECRET` (min 32 characters)
4. Enable `httpOnly` and `sameSite: 'strict'` for cookies
5. Add rate limiting to auth endpoints
6. Consider adding CSRF protection

### Environment Variables

**Required**:
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- `JWT_SECRET` (min 32 random characters)

**Optional**:
- `FRONTEND_URL` (default: `http://localhost:5173`)
- `AUTH_DB_PATH` (default: `./users.db`)
- `PORT` (default: `3000`)

## Troubleshooting

### "No authentication token provided"
- Check that the token is in localStorage: `localStorage.getItem('auth_token')`
- Verify the backend is running and accepting requests

### OAuth redirect errors
- Ensure callback URLs match exactly in OAuth provider settings
- Check that `FRONTEND_URL` in `.env` matches your dev server URL
- Verify CORS is enabled for your frontend URL

### "Invalid or expired token"
- Token may have expired (7 days). Try logging out and back in.
- Use `/auth/refresh` to get a new access token without re-authenticating

### Database errors
- Ensure the backend has write permissions for `users.db`
- Check that `better-sqlite3` installed correctly: `npm install --workspace=backend`

## Testing

### Manual Testing Checklist

- [ ] Landing page loads with glitchy effects
- [ ] Google OAuth button redirects to Google
- [ ] Google auth completes and redirects to `/app`
- [ ] GitHub OAuth button redirects to GitHub
- [ ] GitHub auth completes and redirects to `/app`
- [ ] User info appears in app header
- [ ] Logout button clears session and returns to landing page
- [ ] Refreshing `/app` while logged in preserves session
- [ ] Accessing `/app` while logged out redirects to landing
- [ ] Token refresh works after 7 days (or manually expire token)

## Next Steps

1. **Production deployment**: Update OAuth callback URLs to production domain
2. **Add more providers**: Steam, Discord, etc. using similar Passport strategies
3. **Email verification**: Add email verification step after OAuth
4. **User profiles**: Add editable user profiles and preferences
5. **Admin panel**: Create admin interface for user management
6. **Analytics**: Track login/usage metrics
7. **2FA**: Add two-factor authentication option

## Support

For issues or questions:
- Check the console for error messages
- Verify OAuth credentials are correct
- Ensure all dependencies are installed
- Check that both backend and frontend are running

Happy hacking! Did you pay the 1? 📚✨
