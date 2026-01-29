# Use official Node.js runtime
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
# Using npm ci for reliable builds
RUN npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Expose port 8080 (standard for Cloud Run / Zeabur)
EXPOSE 8080

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# Start the Node.js server (which serves static files AND API)
CMD ["npm", "start"]
