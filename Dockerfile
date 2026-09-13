FROM node:22-alpine

WORKDIR /app

# Dependencies first, so editing source doesn't reinstall them.
# tsx is a runtime dependency: the TypeScript sources are executed directly,
# there is no build step to keep in sync.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production

# Long polling: the container reaches out to Telegram, so it exposes no ports.
CMD ["npx", "tsx", "src/index.ts"]
