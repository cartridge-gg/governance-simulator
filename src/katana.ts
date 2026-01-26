import { spawn, ChildProcess } from 'child_process';
import type { KatanaConfig, DevAccount } from './types.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5050;
const STARTUP_TIMEOUT_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 100;

/**
 * Manages a Katana instance lifecycle (spawn, health check, teardown)
 */
export class KatanaInstance {
  private process: ChildProcess | null = null;
  private _port: number = DEFAULT_PORT;
  private _host: string = DEFAULT_HOST;
  private _isRunning: boolean = false;

  /**
   * Start a new Katana instance with the given configuration
   */
  async start(config: KatanaConfig): Promise<void> {
    if (this._isRunning) {
      throw new Error('Katana instance is already running');
    }

    this._port = config.port ?? DEFAULT_PORT;
    this._host = config.host ?? DEFAULT_HOST;

    const args = this.buildArgs(config);

    this.process = spawn('katana', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Collect stderr for error reporting
    let stderrOutput = '';
    this.process.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    // Handle process errors
    this.process.on('error', (err) => {
      this._isRunning = false;
      throw new Error(`Failed to start Katana: ${err.message}`);
    });

    this.process.on('exit', (code) => {
      this._isRunning = false;
      if (code !== 0 && code !== null) {
        console.error(`Katana exited with code ${code}: ${stderrOutput}`);
      }
    });

    // Wait for Katana to be ready
    await this.waitForReady();
    this._isRunning = true;
  }

  /**
   * Build command line arguments for Katana
   */
  private buildArgs(config: KatanaConfig): string[] {
    const args = [
      '--http.addr', this._host,
      '--http.port', this._port.toString(),
      '--dev',
      '--fork.provider', config.forkUrl,
    ];

    if (config.forkBlock !== undefined && config.forkBlock !== 'latest') {
      args.push('--fork.block', config.forkBlock.toString());
    }

    return args;
  }

  /**
   * Wait for Katana to be ready to accept requests
   */
  private async waitForReady(): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      try {
        const response = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'starknet_chainId',
            params: [],
            id: 1,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.result) {
            return;
          }
        }
      } catch {
        // Katana not ready yet, continue polling
      }

      await this.sleep(HEALTH_CHECK_INTERVAL_MS);
    }

    // Cleanup and throw if we timed out
    await this.stop();
    throw new Error(`Katana failed to start within ${STARTUP_TIMEOUT_MS}ms`);
  }

  /**
   * Stop the Katana instance
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');

      // Wait a bit for graceful shutdown
      await this.sleep(500);

      // Force kill if still running
      if (!this.process.killed) {
        this.process.kill('SIGKILL');
      }

      this.process = null;
    }
    this._isRunning = false;
  }

  /**
   * Get the RPC URL for this Katana instance
   */
  get rpcUrl(): string {
    return `http://${this._host}:${this._port}`;
  }

  /**
   * Check if the instance is currently running
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get the port this instance is running on
   */
  get port(): number {
    return this._port;
  }

  /**
   * Make an RPC call to Katana
   */
  async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
    }

    return data.result as T;
  }

  /**
   * Get pre-deployed dev accounts from Katana
   */
  async getDevAccounts(): Promise<DevAccount[]> {
    return this.rpcCall<DevAccount[]>('dev_predeployedAccounts');
  }

  /**
   * Set storage at a specific key in a contract
   */
  async devSetStorageAt(
    contractAddress: string,
    key: string,
    value: string
  ): Promise<void> {
    await this.rpcCall('dev_setStorageAt', [contractAddress, key, value]);
  }

  /**
   * Get storage at a specific key from a contract
   */
  async getStorageAt(contractAddress: string, key: string): Promise<string> {
    return this.rpcCall<string>('starknet_getStorageAt', [
      contractAddress,
      key,
      'latest',
    ]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Find an available port starting from the given port
 */
export async function findAvailablePort(startPort: number = 5050): Promise<number> {
  let port = startPort;
  const maxAttempts = 100;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: 'HEAD',
      });
      // Port is in use, try next
      port++;
    } catch {
      // Port is available (connection refused)
      return port;
    }
  }

  throw new Error(`Could not find available port after ${maxAttempts} attempts`);
}
