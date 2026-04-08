# Fablescribe Bot — Production image
# Build: docker build -t fablescribe-bot bot/
# Run:   docker run -p 3001:3001 --env-file bot/.env fablescribe-bot

FROM node:20-slim AS base

# Install:
# - python3/make/g++: build deps for native modules (libsodium-wrappers fallback
#   uses pure JS, but @discordjs/voice may pull native crypto; opusscript is
#   pure JS so no libopus needed)
# - ffmpeg: required at runtime by @discordjs/voice / prism-media to transcode
#   MP3/AAC audio (e.g. ElevenLabs TTS responses) into Opus before sending to
#   Discord. Without it, createAudioResource() throws "FFmpeg/avconv not found!"
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (cached layer)
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --omit=dev

# Copy source
COPY . .

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/index.js"]
