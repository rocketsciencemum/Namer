FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY data/abn.json ./data/abn.json

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
