# Runtime stage with pre-built Katana binary
# Using Ubuntu 24.04 for glibc 2.39 compatibility with katana binary
FROM ubuntu:24.04

# Install runtime dependencies and Node.js
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Download pre-built Katana binary
ENV KATANA_VERSION=v1.7.0
RUN curl -L https://github.com/dojoengine/katana/releases/download/${KATANA_VERSION}/katana_${KATANA_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin

# Verify Katana installation
RUN katana --version

# Set up app directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Railway sets PORT dynamically, app reads from process.env.PORT

# Start the simulator
CMD ["node", "dist/index.js"]
