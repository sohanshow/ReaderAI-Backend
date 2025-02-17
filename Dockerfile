# Use Node.js LTS Alpine image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application (adjust this based on your project's build script)
RUN npm run build

# Expose the port your app runs on
EXPOSE 3000

# Command to run the application
CMD ["npm", "run", "start:prod"]