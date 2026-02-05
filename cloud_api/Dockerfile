# syntax=docker/dockerfile:1

# ============================================
# Build Stage
# ============================================
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# ============================================
# Production Stage
# ============================================
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    dumb-init \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp (ARG forces cache bust on update)
ARG YTDLP_VERSION=latest
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

# Create non-root user with home directory for yt-dlp cache
RUN groupadd -r nodejs && useradd -r -g nodejs -m -d /home/nodejs nodejs \
  && mkdir -p /home/nodejs/.cache/yt-dlp \
  && chown -R nodejs:nodejs /home/nodejs

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application files
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs server.js ./
COPY --chown=nodejs:nodejs instrument.js ./
COPY --chown=nodejs:nodejs worker-pool.js ./
COPY --chown=nodejs:nodejs ytdlp-worker.js ./
COPY --chown=nodejs:nodejs config ./config
COPY --chown=nodejs:nodejs middleware ./middleware
COPY --chown=nodejs:nodejs routes ./routes
COPY --chown=nodejs:nodejs utils ./utils

# Create logs directory
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Switch to non-root user
USER nodejs

# Environment variables
ENV NODE_ENV=production \
    PORT=3000

# Expose port
EXPOSE 3000

# Health check (uses PORT env var, defaults to 3000)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "server.js"]
