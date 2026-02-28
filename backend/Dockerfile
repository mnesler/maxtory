# ============================================================================
# Dockerfile for Maxtory Backend (Attractor + Auth)
# ============================================================================
# Multi-stage build for optimal image size and security
# Final image size target: ~150MB
# ============================================================================

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: Base dependencies
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && ln -sf python3 /usr/bin/python

WORKDIR /app

# ──────────────────────────────────────────────────────────────────────────
# Stage 2: Dependencies installer
# ──────────────────────────────────────────────────────────────────────────
FROM base AS deps

# Copy root package files for workspace setup
COPY package*.json ./

# Copy backend package files
COPY backend/package*.json ./backend/

# Install ALL dependencies (including devDependencies for build)
# Use npm ci for faster, reproducible installs
RUN npm ci --workspace=backend --include-workspace-root

# ──────────────────────────────────────────────────────────────────────────
# Stage 3: Builder
# ──────────────────────────────────────────────────────────────────────────
FROM deps AS builder

# Copy backend source code
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src

# Build TypeScript → JavaScript
RUN npm run build --workspace=backend

# ──────────────────────────────────────────────────────────────────────────
# Stage 4: Production dependencies only
# ──────────────────────────────────────────────────────────────────────────
FROM base AS prod-deps

# Copy root package files
COPY package*.json ./

# Copy backend package files
COPY backend/package*.json ./backend/

# Install ALL dependencies (including devDependencies for better-sqlite3 native modules)
RUN npm ci --workspace=backend --include-workspace-root

# ──────────────────────────────────────────────────────────────────────────
# Stage 5: Production runtime (FINAL IMAGE)
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install runtime dependencies only (better-sqlite3 needs these)
RUN apk add --no-cache \
    tini

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy production dependencies from prod-deps stage
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /app/backend/node_modules ./backend/node_modules

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/backend/dist ./backend/dist

# Copy package.json files (needed for imports and metadata)
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs backend/package*.json ./backend/

# Create directory for SQLite database (users.db)
RUN mkdir -p /app/backend/data && \
    chown -R nodejs:nodejs /app/backend/data

# Switch to non-root user
USER nodejs

# Expose port (Cloud Run will inject PORT env var)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "backend/dist/index.js"]

# ──────────────────────────────────────────────────────────────────────────
# Stage 6: Development (for docker-compose)
# ──────────────────────────────────────────────────────────────────────────
FROM deps AS development

# Install tsx for development hot reload
RUN npm install -g tsx

# Copy source code (will be overridden by volume mount)
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src

WORKDIR /app

# Expose port
EXPOSE 3001

# Development mode with hot reload
CMD ["npm", "run", "dev", "--workspace=backend"]

# ──────────────────────────────────────────────────────────────────────────
# Build Instructions:
# ──────────────────────────────────────────────────────────────────────────
# Production:
#   docker build -t maxtory-backend -f backend/Dockerfile .
#
# Development:
#   docker build --target development -t maxtory-backend-dev -f backend/Dockerfile .
#
# Cloud Build:
#   gcloud builds submit --tag gcr.io/PROJECT_ID/maxtory-backend \
#     --dockerfile=backend/Dockerfile .
# ──────────────────────────────────────────────────────────────────────────
