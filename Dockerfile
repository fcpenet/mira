FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Non-root user for security
RUN addgroup -S mira && adduser -S mira -G mira
USER mira

EXPOSE 3000

CMD ["node", "src/server.js"]
