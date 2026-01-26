/**
 * Configuration for starting a Katana instance
 */
export interface KatanaConfig {
  /** RPC URL to fork from (e.g., mainnet) */
  forkUrl: string;
  /** Block number to fork at, or 'latest' */
  forkBlock?: number | 'latest';
  /** Port to run Katana on (default: 5050) */
  port?: number;
  /** Host to bind to (default: 127.0.0.1) */
  host?: string;
}

/**
 * A single call in a governance proposal
 */
export interface Call {
  /** Target contract address */
  to: string;
  /** Function selector (name or hex) */
  selector: string;
  /** Calldata as hex strings */
  calldata: string[];
}

/**
 * Storage diff entry showing a change to contract storage
 */
export interface StorageDiffEntry {
  /** Contract whose storage changed */
  contractAddress: string;
  /** Storage key that changed */
  key: string;
  /** Previous value (if available) */
  oldValue?: string;
  /** New value after execution */
  newValue: string;
}

/**
 * Aggregated state diff from simulation
 */
export interface StateDiff {
  /** All storage changes */
  storageDiffs: StorageDiffEntry[];
  /** Contracts that were deployed (class hash changes) */
  deployedContracts?: Array<{
    address: string;
    classHash: string;
  }>;
  /** Contracts whose class was replaced */
  replacedClasses?: Array<{
    address: string;
    oldClassHash: string;
    newClassHash: string;
  }>;
  /** Nonces that changed */
  nonces?: Array<{
    contractAddress: string;
    nonce: string;
  }>;
}

/**
 * An event emitted during simulation
 */
export interface SimulatedEvent {
  /** Contract that emitted the event */
  contractAddress: string;
  /** Event keys (first key is typically the event selector) */
  keys: string[];
  /** Event data */
  data: string[];
}

/**
 * Internal call trace from execution
 */
export interface InternalCall {
  /** Contract being called */
  contractAddress: string;
  /** Entry point selector */
  selector: string;
  /** Calldata */
  calldata: string[];
  /** Return data */
  result: string[];
  /** Nested calls */
  calls: InternalCall[];
  /** Events emitted by this call */
  events: SimulatedEvent[];
  /** Revert reason if this call failed */
  revertReason?: string;
}

/**
 * Top-level execution trace
 */
export interface ExecutionTrace {
  /** Entry point contract */
  contractAddress: string;
  /** Entry point selector */
  selector: string;
  /** Entry point calldata */
  calldata: string[];
  /** Return data */
  result: string[];
  /** All internal calls */
  internalCalls: InternalCall[];
  /** Revert reason if execution failed */
  revertReason?: string;
}

/**
 * Full simulation result returned to the client
 */
export interface SimulationResult {
  /** Whether the simulation succeeded */
  success: boolean;
  /** Revert reason if simulation failed */
  revertReason?: string;
  /** All state changes that would occur */
  stateDiff: StateDiff;
  /** All events that would be emitted */
  events: SimulatedEvent[];
  /** Full execution trace */
  executionTrace?: ExecutionTrace;
  /** Estimated gas consumption */
  gasEstimate?: string;
  /** Overall fee estimate */
  feeEstimate?: string;
}

/**
 * Request body for the /simulate endpoint
 */
export interface SimulateRequest {
  /** Address of the timelock contract making the calls */
  timelockAddress: string;
  /** Calls to simulate */
  calls: Call[];
  /** Optional: specific block to fork at */
  forkBlock?: number | 'latest';
  /** Optional: additional token addresses to copy balances for */
  additionalTokens?: string[];
}

/**
 * Response from the /simulate endpoint
 */
export interface SimulateResponse {
  /** Simulation result if successful */
  result?: SimulationResult;
  /** Error message if request failed */
  error?: string;
}

/**
 * Katana dev account info returned by dev_predeployedAccounts
 */
export interface DevAccount {
  address: string;
  privateKey: string;
  publicKey: string;
  balance: string;
}

/**
 * Token balance info for copying
 */
export interface TokenBalance {
  tokenAddress: string;
  balanceLow: string;
  balanceHigh: string;
}
