import { hash, num, CallData } from 'starknet';
import type { KatanaInstance } from './katana.js';
import { copyAllTokenBalances } from './storage.js';
import type {
  Call,
  SimulationResult,
  SimulatedEvent,
  StorageDiffEntry,
  ExecutionTrace,
  InternalCall,
  DevAccount,
} from './types.js';

/**
 * Raw simulation response from starknet_simulateTransactions (Katana 1.7.0+ / RPC 0.9.0)
 */
interface RawSimulationResponse {
  transaction_trace?: {
    type?: string;
    execute_invocation?: RawInternalCall;
    validate_invocation?: unknown;
    fee_transfer_invocation?: unknown;
    execution_resources?: {
      l1_gas: number;
      l1_data_gas: number;
      l2_gas: number;
    };
  };
  fee_estimation?: {
    l1_gas_consumed?: string;
    l1_gas_price?: string;
    l2_gas_consumed?: string;
    l2_gas_price?: string;
    l1_data_gas_consumed?: string;
    l1_data_gas_price?: string;
    overall_fee?: string;
    // Legacy fields for backwards compatibility
    gas_consumed?: string;
    gas_price?: string;
    unit?: string;
  };
  state_diff?: {
    storage_diffs?: Array<{
      address: string;
      storage_entries: Array<{
        key: string;
        value: string;
      }>;
    }>;
    deployed_contracts?: Array<{
      address: string;
      class_hash: string;
    }>;
    replaced_classes?: Array<{
      contract_address: string;
      class_hash: string;
    }>;
    nonces?: Array<{
      contract_address: string;
      nonce: string;
    }>;
    deprecated_declared_classes?: string[];
    declared_classes?: Array<{
      class_hash: string;
      compiled_class_hash: string;
    }>;
  };
}

interface RawInternalCall {
  contract_address: string;
  entry_point_selector: string;
  calldata: string[];
  result: string[];
  revert_reason?: string;
  is_reverted?: boolean;
  caller_address?: string;
  class_hash?: string;
  entry_point_type?: string;
  call_type?: string;
  events?: Array<{
    order?: number;
    keys: string[];
    data: string[];
  }>;
  calls?: RawInternalCall[];
  messages?: unknown[];
  execution_resources?: {
    l1_gas: number;
    l2_gas: number;
  };
}

/**
 * Build the calldata for a multicall transaction
 * Follows the Starknet account __execute__ interface
 */
export function buildMulticallCalldata(calls: Call[]): string[] {
  const calldata: string[] = [];

  // First element: number of calls
  calldata.push(num.toHex(calls.length));

  // Each call: to, selector, calldata_offset, calldata_len
  let dataOffset = 0;
  const callDataArrays: string[][] = [];

  for (const call of calls) {
    calldata.push(num.toHex(call.to));

    // Convert selector name to hash if it's not already a hex
    const selectorHash = call.selector.startsWith('0x')
      ? call.selector
      : hash.getSelectorFromName(call.selector);
    calldata.push(selectorHash);

    // Calldata length for this call
    calldata.push(num.toHex(call.calldata.length));

    callDataArrays.push(call.calldata);
    dataOffset += call.calldata.length;
  }

  // Append all calldata
  for (const data of callDataArrays) {
    calldata.push(...data.map((d) => num.toHex(d)));
  }

  return calldata;
}

/**
 * Parse raw internal call trace into typed structure
 */
function parseInternalCall(raw: RawInternalCall): InternalCall {
  return {
    contractAddress: raw.contract_address,
    selector: raw.entry_point_selector,
    calldata: raw.calldata || [],
    result: raw.result || [],
    calls: (raw.calls || []).map(parseInternalCall),
    events: (raw.events || []).map((e) => ({
      contractAddress: raw.contract_address,
      keys: e.keys,
      data: e.data,
    })),
    revertReason: raw.revert_reason,
  };
}

/**
 * Collect all events from the execution trace (recursively)
 * In RPC 0.9.0+, events don't have from_address - it comes from the parent call
 */
function collectAllEvents(trace: RawInternalCall | undefined): SimulatedEvent[] {
  if (!trace) return [];

  // Events emitted by this call - use the call's contract_address
  const events: SimulatedEvent[] = (trace.events || []).map((e) => ({
    contractAddress: trace.contract_address,
    keys: e.keys,
    data: e.data,
  }));

  // Recursively collect from internal calls
  for (const call of trace.calls || []) {
    events.push(...collectAllEvents(call));
  }

  return events;
}

/**
 * Parse the raw simulation response into a structured result
 */
export function parseSimulationResult(raw: RawSimulationResponse): SimulationResult {
  const executeTrace = raw.transaction_trace?.execute_invocation;
  const stateDiff = raw.state_diff;
  const feeEstimation = raw.fee_estimation;

  // Collect all events from the trace
  const allEvents = collectAllEvents(executeTrace);

  // Build storage diffs
  const storageDiffs: StorageDiffEntry[] = [];
  if (stateDiff?.storage_diffs) {
    for (const diff of stateDiff.storage_diffs) {
      for (const entry of diff.storage_entries) {
        storageDiffs.push({
          contractAddress: diff.address,
          key: entry.key,
          newValue: entry.value,
        });
      }
    }
  }

  // Build execution trace
  let executionTrace: ExecutionTrace | undefined;
  if (executeTrace) {
    executionTrace = {
      contractAddress: executeTrace.contract_address || '',
      selector: executeTrace.entry_point_selector || '',
      calldata: executeTrace.calldata || [],
      result: executeTrace.result || [],
      internalCalls: (executeTrace.calls || []).map(parseInternalCall),
      revertReason: executeTrace.revert_reason,
    };
  }

  // Check for revert - can be indicated by revert_reason or is_reverted flag
  const isReverted = executeTrace?.is_reverted || !!executeTrace?.revert_reason;
  const revertReason = executeTrace?.revert_reason;

  return {
    success: !isReverted,
    revertReason,
    stateDiff: {
      storageDiffs,
      deployedContracts: stateDiff?.deployed_contracts?.map((c) => ({
        address: c.address,
        classHash: c.class_hash,
      })),
      replacedClasses: stateDiff?.replaced_classes?.map((c) => ({
        address: c.contract_address,
        oldClassHash: '', // Not available in response
        newClassHash: c.class_hash,
      })),
      nonces: stateDiff?.nonces?.map((n) => ({
        contractAddress: n.contract_address,
        nonce: n.nonce,
      })),
    },
    events: allEvents,
    executionTrace,
    // Use new l1_gas_consumed field, fallback to legacy gas_consumed
    gasEstimate: feeEstimation?.l1_gas_consumed || feeEstimation?.gas_consumed,
    feeEstimate: feeEstimation?.overall_fee,
  };
}

/**
 * Simulate a governance proposal on a Katana fork
 */
export async function simulateProposal(
  katana: KatanaInstance,
  timelockAddress: string,
  calls: Call[],
  additionalTokens: string[] = []
): Promise<SimulationResult> {
  // Get a dev account to use for simulation
  const devAccounts = await katana.getDevAccounts();
  if (!devAccounts || devAccounts.length === 0) {
    throw new Error('No dev accounts available from Katana');
  }

  const testAccount = devAccounts[0];

  // Copy timelock's token balances to test account
  await copyAllTokenBalances(
    katana,
    timelockAddress,
    testAccount.address,
    additionalTokens
  );

  // Build multicall transaction
  const calldata = buildMulticallCalldata(calls);

  // Get current nonce for test account
  const nonce = await katana.rpcCall<string>('starknet_getNonce', [
    'latest',
    testAccount.address,
  ]);

  // Build INVOKE V3 transaction for simulation
  // Katana 1.7.0+ uses Starknet RPC 0.9.0 which requires V3 format
  const simulationParams = {
    block_id: 'latest',
    transactions: [
      {
        type: 'INVOKE',
        version: '0x3',
        sender_address: testAccount.address,
        calldata: calldata,
        signature: [],
        nonce: nonce,
        resource_bounds: {
          l1_gas: { max_amount: '0x0', max_price_per_unit: '0x0' },
          l2_gas: { max_amount: '0x0', max_price_per_unit: '0x0' },
        },
        tip: '0x0',
        paymaster_data: [],
        account_deployment_data: [],
        nonce_data_availability_mode: 'L1',
        fee_data_availability_mode: 'L1',
      },
    ],
    simulation_flags: ['SKIP_VALIDATE', 'SKIP_FEE_CHARGE'],
  };

  const rawResult = await katana.rpcCall<RawSimulationResponse[]>(
    'starknet_simulateTransactions',
    simulationParams
  );

  if (!rawResult || rawResult.length === 0) {
    throw new Error('Simulation returned empty result');
  }

  return parseSimulationResult(rawResult[0]);
}

/**
 * Simulate a single call (not a batch) for simpler use cases
 */
export async function simulateSingleCall(
  katana: KatanaInstance,
  timelockAddress: string,
  call: Call,
  additionalTokens: string[] = []
): Promise<SimulationResult> {
  return simulateProposal(katana, timelockAddress, [call], additionalTokens);
}

/**
 * Decode a revert reason string if it's encoded
 */
export function decodeRevertReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;

  // If it's already a string message, return as-is
  if (!reason.startsWith('0x')) {
    return reason;
  }

  try {
    // Try to decode as felt252 string
    const felt = BigInt(reason);
    let decoded = '';
    let remaining = felt;

    while (remaining > 0n) {
      const charCode = Number(remaining & 0xffn);
      if (charCode >= 32 && charCode < 127) {
        decoded = String.fromCharCode(charCode) + decoded;
      }
      remaining = remaining >> 8n;
    }

    return decoded || reason;
  } catch {
    return reason;
  }
}
