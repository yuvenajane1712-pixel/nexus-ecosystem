FROM node:20-slim

# better-sqlite3 needs build tools to compile its native binding
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Note: persistent storage is handled via Railway's Volumes UI + the DB_PATH
# environment variable (e.g. DB_PATH=/app/data/nexus.db) rather than a
# Dockerfile VOLUME directive, since Railway's builder doesn't support VOLUME.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
