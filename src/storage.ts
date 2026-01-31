import { hash, num } from 'starknet';
import type { KatanaInstance } from './katana.js';
import type { TokenBalance } from './types.js';

/**
 * Well-known token addresses on Starknet mainnet
 */
export const KNOWN_TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
  USDT: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
  DAI: '0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3',
  WBTC: '0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac',
};

/**
 * Storage variable names used by different ERC20 implementations
 */
const BALANCE_VARIABLE_NAMES = [
  'ERC20_balances',  // OpenZeppelin standard
  'balances',        // Some custom implementations
];

/**
 * Compute storage key for a given variable name and holder
 */
function computeBalanceKey(variableName: string, holderAddress: string): { low: string; high: string } {
  const selector = hash.getSelectorFromName(variableName);
  const normalizedHolder = num.toHex(holderAddress);
  const baseKey = hash.computePedersenHash(selector, normalizedHolder);
  const highKey = '0x' + (BigInt(baseKey) + 1n).toString(16);
  return { low: baseKey, high: highKey };
}

/**
 * Call balanceOf on a token contract via starknet_call
 * Returns the balance as {low, high} u256 parts
 */
async function callBalanceOf(
  katana: KatanaInstance,
  tokenAddress: string,
  holderAddress: string
): Promise<{ low: string; high: string }> {
  const balanceOfSelector = hash.getSelectorFromName('balance_of');
  const result = await katana.rpcCall<string[]>('starknet_call', [
    {
      contract_address: tokenAddress,
      entry_point_selector: balanceOfSelector,
      calldata: [num.toHex(holderAddress)],
    },
    'latest',
  ]);

  return {
    low: result[0] || '0x0',
    high: result[1] || '0x0',
  };
}

/**
 * Copy an ERC20 token balance from one address to another.
 * Uses balanceOf to verify the correct storage layout.
 */
export async function copyTokenBalance(
  katana: KatanaInstance,
  tokenAddress: string,
  fromAddress: string,
  toAddress: string
): Promise<TokenBalance> {
  // Get actual balance via balanceOf RPC call
  const actualBalance = await callBalanceOf(katana, tokenAddress, fromAddress);
  console.log(`Token ${tokenAddress}: balanceOf(${fromAddress}) = ${actualBalance.low}/${actualBalance.high}`);

  // Skip if balance is zero
  if (actualBalance.low === '0x0' && actualBalance.high === '0x0') {
    console.log(`  Skipping - zero balance`);
    return { tokenAddress, balanceLow: '0x0', balanceHigh: '0x0' };
  }

  // Try each storage variable name until balanceOf confirms the write worked
  for (const varName of BALANCE_VARIABLE_NAMES) {
    const toKeys = computeBalanceKey(varName, toAddress);
    console.log(`  Trying "${varName}" - writing to keys ${toKeys.low}, ${toKeys.high}`);

    // Write balance to destination
    await katana.devSetStorageAt(tokenAddress, toKeys.low, actualBalance.low);
    await katana.devSetStorageAt(tokenAddress, toKeys.high, actualBalance.high);

    // Verify with balanceOf
    const verifyBalance = await callBalanceOf(katana, tokenAddress, toAddress);
    console.log(`  Verified balanceOf(${toAddress}) = ${verifyBalance.low}/${verifyBalance.high}`);

    if (verifyBalance.low === actualBalance.low && verifyBalance.high === actualBalance.high) {
      console.log(`  Success with "${varName}"`);
      return { tokenAddress, balanceLow: actualBalance.low, balanceHigh: actualBalance.high };
    }

    // Reset the failed write
    await katana.devSetStorageAt(tokenAddress, toKeys.low, '0x0');
    await katana.devSetStorageAt(tokenAddress, toKeys.high, '0x0');
  }

  console.warn(`  Could not determine storage layout for token ${tokenAddress}`);
  return { tokenAddress, balanceLow: actualBalance.low, balanceHigh: actualBalance.high };
}

/**
 * Copy all known token balances from source to destination
 */
export async function copyAllTokenBalances(
  katana: KatanaInstance,
  fromAddress: string,
  toAddress: string,
  additionalTokens: string[] = []
): Promise<Map<string, TokenBalance>> {
  const results = new Map<string, TokenBalance>();

  // Combine known tokens with any additional tokens
  const allTokens = [
    ...Object.values(KNOWN_TOKENS),
    ...additionalTokens,
  ];

  // Remove duplicates
  const uniqueTokens = [...new Set(allTokens.map((t) => num.toHex(t)))];

  // Copy each token balance
  for (const tokenAddress of uniqueTokens) {
    try {
      const balance = await copyTokenBalance(
        katana,
        tokenAddress,
        fromAddress,
        toAddress
      );
      results.set(tokenAddress, balance);
    } catch (error) {
      // Log but continue - some tokens may not exist or use different storage
      console.warn(
        `Failed to copy balance for token ${tokenAddress}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return results;
}

/**
 * Format a u256 balance from low/high parts for display
 */
export function formatU256Balance(balanceLow: string, balanceHigh: string): string {
  const low = BigInt(balanceLow);
  const high = BigInt(balanceHigh);
  const value = (high << 128n) + low;
  return value.toString();
}
