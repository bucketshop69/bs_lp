FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY tsconfig.json ./
COPY src/ ./src/

# Build the application
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DOCKER_ENV=true
# Note: ENCRYPTION_KEY must be set as an environment variable at runtime

# Expose the port for health checks
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"] 