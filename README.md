# Governance Proposal Simulator

A service that validates Starknet governance proposals **before** submission by simulating their execution on a mainnet fork.

## Features

- Forks mainnet state using Katana
- Copies timelock token balances to a test account
- Simulates proposal calls using `starknet_simulateTransactions`
- Returns rich feedback:
  - Success/failure status
  - State diffs (storage changes)
  - Events that would be emitted
  - Revert reasons if applicable
  - Gas estimates

## Prerequisites

- Node.js 18+
- [Katana](https://book.dojoengine.org/) 1.7.0+ installed and available in PATH

### Install Katana via asdf (recommended)

```bash
# Add the dojo plugin
asdf plugin add dojo https://github.com/dojoengine/asdf-dojo.git

# Install dojo 1.7.0 (includes katana)
asdf install dojo 1.7.0

# Set as global default
asdf global dojo 1.7.0

# Verify installation
katana --version
```

### Alternative: Install via dojoup

```bash
# Install dojoup
curl -L https://install.dojoengine.org | bash

# Install katana component
~/.dojo/dojoup/dojoup component add katana 1.7.0
```

## Installation

```bash
npm install
```

## Usage

### Start the server

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build && npm start
```

### GHCR Image

GitHub Actions publishes the simulator image to:

- `ghcr.io/<repo-owner>/governance-simulator:latest`

For the canonical repository, that resolves to `ghcr.io/cartridge-gg/governance-simulator:latest`.

Version tags and immutable `sha-...` tags are also produced by the workflow.

Example run command for the current Sepolia-oriented setup:

```bash
docker run -d \
  --name governance-simulator \
  -p 3001:3001 \
  -e PORT=3001 \
  -e HOST=0.0.0.0 \
  -e FORK_URL=https://api.cartridge.gg/x/starknet/sepolia \
  ghcr.io/<repo-owner>/governance-simulator:latest
```

The server runs on port 3001 by default. Set the `PORT` environment variable to change it.

### API Endpoints

#### `GET /health`

Health check endpoint.

```bash
curl http://localhost:3001/health
```

#### `POST /simulate`

Simulate a single governance proposal.

**Request:**
```json
{
  "timelockAddress": "0x123...",
  "calls": [
    {
      "to": "0x456...",
      "selector": "transfer",
      "calldata": ["0x789...", "1000000000000000000"]
    }
  ],
  "forkBlock": 123456,
  "additionalTokens": ["0xabc..."]
}
```

**Response (success):**
```json
{
  "result": {
    "success": true,
    "stateDiff": {
      "storageDiffs": [
        {
          "contractAddress": "0x04718f5a...",
          "key": "0x...",
          "newValue": "0x..."
        }
      ]
    },
    "events": [
      {
        "contractAddress": "0x04718f5a...",
        "keys": ["0x99cd8bde..."],
        "data": ["0x123...", "0x456..."]
      }
    ],
    "executionTrace": { ... },
    "gasEstimate": "12345"
  }
}
```

**Response (failure):**
```json
{
  "result": {
    "success": false,
    "revertReason": "Insufficient balance",
    ...
  }
}
```

#### `POST /simulate-batch`

Simulate multiple proposals in a single Katana instance for better performance.

**Request:**
```json
{
  "timelockAddress": "0x123...",
  "proposals": [
    [{ "to": "...", "selector": "...", "calldata": [...] }],
    [{ "to": "...", "selector": "...", "calldata": [...] }]
  ]
}
```

## Architecture

```
┌──────────────┐     ┌───────────────────┐     ┌─────────────────┐
│   UI         │────▶│  Simulation API   │────▶│  Katana Fork    │
│  (Proposer)  │◀────│  (Node.js)        │◀────│  (Mainnet State)│
└──────────────┘     └───────────────────┘     └─────────────────┘
```

1. UI sends proposal calls to the API
2. API spawns a Katana instance forking mainnet
3. API copies timelock's token balances to a dev account
4. API simulates the proposal using `starknet_simulateTransactions`
5. API parses and returns the results

## Limitations

- `get_caller_address()` in target contracts will return the test account, not the actual timelock
- If targets have access control checking specific caller addresses, simulation may not match reality
- Each simulation spawns a fresh Katana instance which adds latency

## Known Tokens

The following tokens are copied by default:
- ETH: `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
- STRK: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- USDC: `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8`
- USDT: `0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8`
- DAI: `0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3`
- WBTC: `0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac`

Add additional tokens via the `additionalTokens` parameter in the request.

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build
```
