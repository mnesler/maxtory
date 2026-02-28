# ============================================================================
# Maxtory Backend (Attractor + Auth) - Optimized for size
# ============================================================================
# Final image size target: ~250MB (still 3x smaller than before!)
# ============================================================================

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: Builder (TypeScript + native modules)
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install dependencies
RUN npm ci --workspace=backend --include-workspace-root

# Copy source
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src

# Build TypeScript
RUN npm run build --workspace=backend

# ──────────────────────────────────────────────────────────────────────────
# Stage 2: Production runtime (FINAL IMAGE) - Alpine slim
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine

# Install runtime dependencies only
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy ALL dependencies from builder (npm workspaces hoists to root node_modules)
COPY --from=builder /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/backend/dist ./backend/dist

# Copy package.json files
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs backend/package*.json ./backend/

# Create data directory
RUN mkdir -p /app/backend/data && chown -R nodejs:nodejs /app

# Switch to non-root
USER nodejs

ENV NODE_ENV=production PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "backend/dist/index.js"]