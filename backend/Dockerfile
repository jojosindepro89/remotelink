FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src/ ./src/

# Create uploads and logs directories
RUN mkdir -p uploads logs

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S remotelink -u 1001
RUN chown -R remotelink:nodejs /app
USER remotelink

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
