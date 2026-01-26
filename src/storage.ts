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
 * Compute the storage key for an ERC20 balance using OpenZeppelin's storage layout
 *
 * OpenZeppelin Cairo uses: ERC20_balances: Map<ContractAddress, u256>
 * Storage layout: h(sn_keccak("ERC20_balances"), holder_address) for low part
 *                 h(sn_keccak("ERC20_balances"), holder_address) + 1 for high part
 */
export function computeERC20BalanceKey(holderAddress: string): { low: string; high: string } {
  // Get selector for "ERC20_balances" storage variable
  const selector = hash.getSelectorFromName('ERC20_balances');

  // Normalize the holder address
  const normalizedHolder = num.toHex(holderAddress);

  // Compute the storage key using Pedersen hash
  const baseKey = hash.computePedersenHash(selector, normalizedHolder);

  // u256 uses 2 slots: base for low, base+1 for high
  const baseKeyBigInt = BigInt(baseKey);
  const highKey = '0x' + (baseKeyBigInt + 1n).toString(16);

  return {
    low: baseKey,
    high: highKey,
  };
}

/**
 * Alternative ERC20 storage layout used by some contracts
 * Uses "balances" instead of "ERC20_balances"
 */
export function computeAltERC20BalanceKey(holderAddress: string): { low: string; high: string } {
  const selector = hash.getSelectorFromName('balances');
  const normalizedHolder = num.toHex(holderAddress);
  const baseKey = hash.computePedersenHash(selector, normalizedHolder);
  const highKey = '0x' + (BigInt(baseKey) + 1n).toString(16);

  return { low: baseKey, high: highKey };
}

/**
 * Read the ERC20 balance of an address from storage
 */
export async function readERC20Balance(
  katana: KatanaInstance,
  tokenAddress: string,
  holderAddress: string
): Promise<TokenBalance> {
  const keys = computeERC20BalanceKey(holderAddress);

  let balanceLow = await katana.getStorageAt(tokenAddress, keys.low);
  let balanceHigh = await katana.getStorageAt(tokenAddress, keys.high);

  // If balance is 0, try alternative storage layout
  if (balanceLow === '0x0' && balanceHigh === '0x0') {
    const altKeys = computeAltERC20BalanceKey(holderAddress);
    balanceLow = await katana.getStorageAt(tokenAddress, altKeys.low);
    balanceHigh = await katana.getStorageAt(tokenAddress, altKeys.high);
  }

  return {
    tokenAddress,
    balanceLow,
    balanceHigh,
  };
}

/**
 * Copy an ERC20 token balance from one address to another
 */
export async function copyTokenBalance(
  katana: KatanaInstance,
  tokenAddress: string,
  fromAddress: string,
  toAddress: string
): Promise<TokenBalance> {
  // Read the source balance
  const balance = await readERC20Balance(katana, tokenAddress, fromAddress);

  // Skip if balance is zero
  if (balance.balanceLow === '0x0' && balance.balanceHigh === '0x0') {
    return balance;
  }

  // Compute destination keys
  const toKeys = computeERC20BalanceKey(toAddress);

  // Write to destination storage
  await katana.devSetStorageAt(tokenAddress, toKeys.low, balance.balanceLow);
  await katana.devSetStorageAt(tokenAddress, toKeys.high, balance.balanceHigh);

  return balance;
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
 * Copy arbitrary storage slots from one contract to another
 * Useful for copying custom contract state beyond just token balances
 */
export async function copyStorageSlots(
  katana: KatanaInstance,
  fromContract: string,
  toContract: string,
  storageKeys: string[]
): Promise<void> {
  for (const key of storageKeys) {
    const value = await katana.getStorageAt(fromContract, key);
    await katana.devSetStorageAt(toContract, key, value);
  }
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
