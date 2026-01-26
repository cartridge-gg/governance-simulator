import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { KatanaInstance, findAvailablePort } from './katana.js';
import { simulateProposal, decodeRevertReason } from './simulator.js';
import type { SimulateRequest, SimulateResponse, SimulationResult } from './types.js';

const DEFAULT_FORK_URL = process.env.FORK_URL || 'https://api.cartridge.gg/x/starknet/mainnet';

// CORS configuration
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:3000', 'http://localhost:5173']; // Default dev origins

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Check if origin is in allowed list or matches pattern
    const isAllowed = CORS_ORIGINS.some((allowed) => {
      if (allowed === '*') return true;
      if (allowed.startsWith('*.')) {
        // Wildcard subdomain matching (e.g., *.example.com)
        const domain = allowed.slice(2);
        return origin.endsWith(domain);
      }
      return origin === allowed;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // 24 hours
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10); // 1 minute
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10); // 10 requests per window

const simulationRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  message: {
    error: `Too many simulation requests. Please try again later. Limit: ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS / 1000} seconds.`,
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator: (req) => {
    // Use X-Forwarded-For header if behind a proxy, otherwise use IP
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});

/**
 * Create and configure the Express application
 */
export function createApp() {
  const app = express();

  // Trust proxy for correct IP detection behind load balancers
  app.set('trust proxy', 1);

  // Middleware
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));

  // Apply rate limiting to all routes
  app.use(simulationRateLimiter);

  // Health check endpoint (not rate limited due to skip function)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      config: {
        corsOrigins: CORS_ORIGINS,
        rateLimitWindow: RATE_LIMIT_WINDOW_MS,
        rateLimitMax: RATE_LIMIT_MAX_REQUESTS,
      },
    });
  });

  // Main simulation endpoint
  app.post('/simulate', async (req: Request, res: Response) => {
    const body = req.body as SimulateRequest;

    // Validate request
    if (!body.timelockAddress) {
      res.status(400).json({
        error: 'Missing required field: timelockAddress',
      } satisfies SimulateResponse);
      return;
    }

    if (!body.calls || !Array.isArray(body.calls) || body.calls.length === 0) {
      res.status(400).json({
        error: 'Missing or empty calls array',
      } satisfies SimulateResponse);
      return;
    }

    // Validate each call
    for (let i = 0; i < body.calls.length; i++) {
      const call = body.calls[i];
      if (!call.to || !call.selector) {
        res.status(400).json({
          error: `Call ${i} missing required fields: to, selector`,
        } satisfies SimulateResponse);
        return;
      }
      if (!Array.isArray(call.calldata)) {
        body.calls[i].calldata = [];
      }
    }

    const katana = new KatanaInstance();

    try {
      // Find an available port
      const port = await findAvailablePort(5050);

      // Start Katana fork
      await katana.start({
        forkUrl: DEFAULT_FORK_URL,
        forkBlock: body.forkBlock,
        port,
      });

      // Run simulation
      const result = await simulateProposal(
        katana,
        body.timelockAddress,
        body.calls,
        body.additionalTokens
      );

      // Decode revert reason if present
      if (result.revertReason) {
        result.revertReason = decodeRevertReason(result.revertReason);
      }

      res.json({ result } satisfies SimulateResponse);
    } catch (error) {
      console.error('Simulation error:', error);

      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies SimulateResponse);
    } finally {
      // Always clean up Katana
      await katana.stop();
    }
  });

  // Batch simulation endpoint - reuses single Katana instance
  app.post('/simulate-batch', async (req: Request, res: Response) => {
    const { timelockAddress, proposals, forkBlock, additionalTokens } = req.body;

    if (!timelockAddress) {
      res.status(400).json({ error: 'Missing required field: timelockAddress' });
      return;
    }

    if (!proposals || !Array.isArray(proposals) || proposals.length === 0) {
      res.status(400).json({ error: 'Missing or empty proposals array' });
      return;
    }

    const katana = new KatanaInstance();
    const results: Array<{ proposalIndex: number; result?: SimulationResult; error?: string }> = [];

    try {
      const port = await findAvailablePort(5050);

      await katana.start({
        forkUrl: DEFAULT_FORK_URL,
        forkBlock,
        port,
      });

      // Simulate each proposal
      for (let i = 0; i < proposals.length; i++) {
        const calls = proposals[i];

        try {
          const result = await simulateProposal(
            katana,
            timelockAddress,
            calls,
            additionalTokens
          );

          if (result.revertReason) {
            result.revertReason = decodeRevertReason(result.revertReason);
          }

          results.push({ proposalIndex: i, result });
        } catch (error) {
          results.push({
            proposalIndex: i,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      res.json({ results });
    } catch (error) {
      console.error('Batch simulation error:', error);

      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      await katana.stop();
    }
  });

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
    } satisfies SimulateResponse);
  });

  return app;
}
