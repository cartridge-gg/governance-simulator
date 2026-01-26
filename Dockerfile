# Build stage for Katana
FROM rust:1.82-slim-bookworm AS katana-builder

RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Katana 1.7.0 via dojoup
ENV DOJO_VERSION=v1.7.0
RUN curl -L https://install.dojoengine.org | bash && \
    /root/.dojo/bin/dojoup -v $DOJO_VERSION

# Runtime stage
FROM node:20-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Katana binary from builder
COPY --from=katana-builder /root/.dojo/bin/katana /usr/local/bin/katana

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
