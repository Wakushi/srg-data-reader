import { ChainName } from 'entities/chains';
import { Chain } from 'viem';
import { arbitrum, bsc, mainnet } from 'viem/chains';

export function findClosestTimeFrame(
  target: number,
  timestamps: number[][],
): number[] {
  return timestamps.reduce((curr, prev) =>
    Math.abs(curr[0] - target) < Math.abs(prev[0] - target) ? curr : prev,
  );
}

export function getChainByName(chain: ChainName): Chain {
  if (!chain) throw new Error('Missing chain');

  switch (chain) {
    case ChainName.ARBITRUM:
      return arbitrum;
    case ChainName.BSC:
      return bsc;
    case ChainName.ETHEREUM:
    default:
      return mainnet;
  }
}
