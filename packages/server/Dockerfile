FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY migrations ./migrations
RUN npm install --workspace=@team-ai/shared --workspace=@team-ai/server
WORKDIR /app/packages/server
EXPOSE 8080
CMD ["node", "src/index.js"]
