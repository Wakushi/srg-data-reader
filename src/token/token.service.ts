import { Injectable } from '@nestjs/common';
import { ChainName } from 'entities/chains';
import { ExplorerService } from 'src/explorer/explorer.service';
import { Address, Block, formatUnits } from 'viem';
import {
  TRANSFER_EVENT,
  SRG_ETH,
  WETH_USDC_POOL,
  UNISWAP_POOL_ABI,
  IERC20_ABI,
  SRG_DECIMALS,
  ETH_DECIMALS,
} from '../../constants';

type HistoricPrice = {
  timestamp: number;
  nativeBalance: number;
  nativePriceUsd: number;
  srgBalance: bigint;
  srgPriceUsd: number;
};

@Injectable()
export class TokenService {
  constructor(private explorerService: ExplorerService) {}

  async getHistoricalData(token: Address): Promise<any> {
    await this.fetchSRGPrice();
  }

  // NB: Currently fetchSRGPrice is implemented with the idea that the liquidity is the actual ETH balance of the contract
  // However the contract isn't in sync with its liquidity, so it would be interesting to do the same computation but replacing nativeBalance with a liquidity state variable read :)
  public async fetchSRGPrice(): Promise<HistoricPrice[]> {
    const chain = ChainName.ETHEREUM;

    const firstBlock = await this.getSrgCreationBlock(chain, SRG_ETH);
    const lastBlock = await this.explorerService.getBlock(chain);

    if (!firstBlock || !lastBlock) return [];

    const ONE_HOUR_IN_SECOND = 60 * 60;

    const startTime = Number(firstBlock.timestamp);
    const endTime = Number(lastBlock.timestamp);

    const hourlyTimestamps: number[] = [];

    for (let time = startTime; time <= endTime; time += ONE_HOUR_IN_SECOND) {
      hourlyTimestamps.push(time);
    }
    const BATCH_SIZE = 100;
    let batchCounter = 0;
    const totalBatches = Math.floor(hourlyTimestamps.length / 100);

    const balances: HistoricPrice[] = [];

    try {
      while (hourlyTimestamps.length > 0) {
        console.log(
          `Processing batch ${batchCounter}/${totalBatches} (${hourlyTimestamps.length} entries remaining)`,
        );

        const batch = hourlyTimestamps.splice(0, BATCH_SIZE);

        const results = await Promise.all(
          batch.map(async (timestamp) => {
            const closestBlockNumber =
              await this.explorerService.getBlockNumberByTimestamp(
                chain,
                timestamp,
              );

            if (!closestBlockNumber) {
              return {
                timestamp,
                nativeBalance: 0,
                nativePriceUsd: 0,
                srgBalance: 0,
                srgPriceUsd: 0,
              };
            }

            const rawNativeBalance = await this.explorerService.getBalance({
              chain: ChainName.ETHEREUM,
              contract: SRG_ETH,
              blockNumber: closestBlockNumber,
            });

            const nativeBalance = Number(
              formatUnits(rawNativeBalance, ETH_DECIMALS),
            );

            const srgBalance = await this.explorerService.readContract({
              chain: ChainName.ETHEREUM,
              contract: SRG_ETH,
              abi: IERC20_ABI,
              functionName: 'balanceOf',
              blockNumber: closestBlockNumber,
              args: [SRG_ETH],
            });

            const ethPriceUsd = await this.getEthPriceUsd(
              chain,
              closestBlockNumber,
            );

            const srgPriceEth =
              nativeBalance / Number(formatUnits(srgBalance, SRG_DECIMALS));

            const srgPriceUsd = srgPriceEth * ethPriceUsd;

            return {
              timestamp,
              nativeBalance: nativeBalance,
              nativePriceUsd: ethPriceUsd,
              srgBalance,
              srgPriceUsd,
            };
          }),
        );

        balances.push(...results);

        batchCounter++;
      }
    } catch (error) {
      console.error('Error fetching balances: ', error);
    }

    return balances;
  }

  public async getSrgCreationBlock(
    chain: ChainName,
    contract: Address,
  ): Promise<Block | null> {
    const transferLogs = await this.explorerService.getLogs({
      chain: ChainName.ETHEREUM,
      contract: contract,
      event: TRANSFER_EVENT,
      fromBlock: 'earliest',
    });

    if (!transferLogs || !transferLogs.length) return null;

    const block = await this.explorerService.getBlock(
      chain,
      transferLogs[0].blockNumber,
    );

    return block;
  }

  public async getEthPriceUsd(
    chain: ChainName,
    blockNumber?: bigint,
  ): Promise<any> {
    try {
      const slot0Data = await this.explorerService.readContract({
        chain,
        contract: WETH_USDC_POOL,
        abi: UNISWAP_POOL_ABI,
        functionName: 'slot0',
        blockNumber,
      });

      if (!slot0Data) {
        throw new Error('Failed to fetch data from Uniswap pool');
      }

      const sqrtPriceX96 = slot0Data[0];

      const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
      const priceRatio = sqrtPrice * sqrtPrice;
      const ethPriceInUSD = 1 / (priceRatio / 10 ** 12);

      return ethPriceInUSD;
    } catch (error) {
      console.error('Error fetching ETH price from Uniswap:', error);
      throw error;
    }
  }
}
