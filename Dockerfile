FROM oven/bun:1.2-debian

# ffmpeg faz a mixagem; yt-dlp baixa video+legenda (binario estatico, sem pip)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY public ./public

ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1

CMD ["bun", "src/index.ts"]
