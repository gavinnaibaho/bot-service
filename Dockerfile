FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY src ./src
ENV DATABASE_URL=sqlite:///data/toko.sqlite
VOLUME /data
CMD ["bun", "src/index.ts"]
