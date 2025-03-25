import { Injectable } from '@nestjs/common';
import { ChainName } from 'entities/chains';
import { ExplorerService } from 'src/explorer/explorer.service';
import { Address, Block, formatUnits, getAddress } from 'viem';
import {
  TRANSFER_EVENT,
  WETH_USDC_POOL,
  UNISWAP_POOL_ABI,
  IERC20_ABI,
  SRG_DECIMALS,
  SRG_ABI,
  ONE_HOUR_IN_SECOND,
  SRG_BOUGHT_EVENT,
  SRG_SOLD_EVENT,
} from '../lib/constants';
import { HistoricPrice, Srg20HourlyPrice } from './entities/token.types';
import { SupabaseService } from 'src/supabase/supabase.service';
import { Collection } from 'src/supabase/entities/collections.type';

@Injectable()
export class TokenService {
  constructor(
    private explorerService: ExplorerService,
    private supabaseService: SupabaseService,
  ) {}

  public async getSrg20PriceHistory(contract: Address): Promise<number[][]> {
    const history = await this.supabaseService.getTokenHistory(contract);

    if (!history) return [];

    return history.map((metrics) => [
      metrics.timestamp,
      metrics.real_price_usd,
    ]);
  }

  public async getSrg20LiquidityHistory(
    contract: Address,
  ): Promise<number[][]> {
    const history = await this.supabaseService.getTokenHistory(contract);

    if (!history) return [];

    return history.map((metrics) => [
      metrics.timestamp,
      metrics.real_liquidity_usd,
    ]);
  }

  public async extractSrg20History({
    contract,
    chain,
    fromTimestamp,
    save = false,
  }: {
    contract: Address;
    chain: ChainName;
    save?: boolean;
    fromTimestamp?: number;
  }): Promise<void> {
    const srgHistory = await this.getSrgHistory(
      Collection.SURGE_HISTORICAL_DATA,
    );

    if (!srgHistory) {
      throw new Error('Unable to fetch $SRG price history');
    }

    const tokenName = await this.explorerService.readContract({
      chain,
      contract,
      abi: SRG_ABI,
      functionName: 'name',
    });

    if (!tokenName) {
      throw new Error('Unable to retrieve token name');
    }

    console.log(`Extracting data for $${tokenName}`);

    let firstBlock: Block | null = null;

    if (fromTimestamp) {
      const blockNumber = await this.explorerService.getBlockNumberByTimestamp(
        chain,
        fromTimestamp,
      );
      firstBlock = await this.explorerService.getBlock(chain, blockNumber);
    } else {
      firstBlock = await this.getSrgCreationBlock(chain, contract);
    }

    const lastBlock = await this.explorerService.getBlock(chain);

    if (!firstBlock || !lastBlock) return;

    const startTime = Number(firstBlock.timestamp);
    const endTime = Number(lastBlock.timestamp);

    const hourlyTimestamps: number[] = [];

    for (let time = startTime; time <= endTime; time += ONE_HOUR_IN_SECOND) {
      hourlyTimestamps.push(time);
    }

    const BATCH_SIZE = 100;
    const totalBatches = Math.floor(hourlyTimestamps.length / BATCH_SIZE);

    let batchCounter = 0;
    let batch: number[] = [];

    const MAX_RETRIES = 5;
    let retries = 0;

    while (hourlyTimestamps.length > 0 && retries <= MAX_RETRIES) {
      console.log(
        `Processing batch ${batchCounter}/${totalBatches} (${hourlyTimestamps.length} entries remaining)`,
      );

      if (retries > 0) {
        console.log(
          `Batch failed, retrying (attempt ${retries}/${MAX_RETRIES})..`,
        );

        await new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 2000 * retries);
        });
      } else {
        batch = hourlyTimestamps.splice(0, BATCH_SIZE);
      }

      try {
        const batchResults: Omit<Srg20HourlyPrice, 'id'>[] = await Promise.all(
          batch.map(async (timestamp) => {
            return await this.buildSrg20HourlyPrice({
              srgHistory,
              timestamp,
              chain,
              contract,
            });
          }),
        );

        if (save) {
          await this.supabaseService.batchInsert<Srg20HourlyPrice>({
            collection: Collection.TOKEN_PRICE_HISTORY,
            items: batchResults,
            options: {
              batchSize: BATCH_SIZE,
              onConflict: 'token_address,chain,timestamp',
              ignoreDuplicates: false,
              progressLabel: 'hourly prices',
            },
          });
        }

        retries = 0;
        batchCounter++;
      } catch (error) {
        retries++;
      }
    }
  }

  private async buildSrg20HourlyPrice({
    srgHistory,
    timestamp,
    chain,
    contract,
  }: {
    srgHistory: HistoricPrice[];
    timestamp: number;
    chain: ChainName;
    contract: Address;
  }): Promise<Srg20HourlyPrice> {
    const closestBlockNumber =
      await this.explorerService.getBlockNumberByTimestamp(chain, timestamp);

    const history: Srg20HourlyPrice = {
      timestamp,
      chain,
      token_address: contract,
      srg_balance: 0,
      token_balance: 0,
      internal_price_usd: 0,
      real_price_usd: 0,
      internal_liquidity_usd: 0,
      real_liquidity_usd: 0,
    };

    if (!closestBlockNumber) return history;

    const rawSrg20Balance: bigint = await this.explorerService.readContract({
      chain,
      contract,
      abi: IERC20_ABI,
      functionName: 'balanceOf',
      blockNumber: closestBlockNumber,
      args: [contract],
    });

    const srg20Balance = Number(formatUnits(rawSrg20Balance, SRG_DECIMALS));

    const rawSrgBalance: bigint = await this.explorerService.readContract({
      chain,
      contract,
      abi: SRG_ABI,
      functionName: 'getLiquidity',
      blockNumber: closestBlockNumber,
    });

    const srgBalance = Number(formatUnits(rawSrgBalance, SRG_DECIMALS));

    const srgPrice = srgHistory.find(
      (price) =>
        timestamp >= price.timestamp - ONE_HOUR_IN_SECOND / 2 &&
        timestamp <= price.timestamp + ONE_HOUR_IN_SECOND / 2,
    );

    if (!srgPrice) return history;

    const srg20PriceSrg = srgBalance / srg20Balance;

    const internalSrg20PriceUsd =
      srg20PriceSrg * srgPrice.internal_srg_price_usd;

    const realSrg20PriceUsd = srg20PriceSrg * srgPrice.real_price_usd;

    history.srg_balance = srgBalance;
    history.token_balance = srg20Balance;
    history.internal_price_usd = internalSrg20PriceUsd;
    history.real_price_usd = realSrg20PriceUsd;
    history.internal_liquidity_usd =
      srgBalance * srgPrice.internal_srg_price_usd +
      srg20Balance * internalSrg20PriceUsd;
    history.real_liquidity_usd =
      srgBalance * srgPrice.real_price_usd + srg20Balance * realSrg20PriceUsd;

    return history;
  }

  public async getSrg20VolumeHistory({
    contract,
    chain,
  }: {
    contract: Address;
    chain: ChainName;
  }): Promise<number[][]> {
    const priceHistory = await this.getSrg20PriceHistory(contract);

    if (!priceHistory) return [];

    const buyEvents = await this.explorerService.getLogs({
      chain,
      contract,
      event: SRG_BOUGHT_EVENT,
    });

    const soldEvents = await this.explorerService.getLogs({
      chain,
      contract,
      event: SRG_SOLD_EVENT,
    });

    const allEvents = [...buyEvents, ...soldEvents];

    if (!allEvents.length) return [];

    allEvents.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));

    const startBlock = await this.explorerService.getBlock(
      chain,
      allEvents[0].blockNumber,
    );

    const lastBlock = await this.explorerService.getBlock(chain);

    if (!startBlock || !lastBlock) return [];

    const startTime = Number(startBlock.timestamp);
    const endTime = Number(lastBlock.timestamp);

    const hourlyTimestamps: number[][] = [];

    for (let time = startTime; time <= endTime; time += ONE_HOUR_IN_SECOND) {
      hourlyTimestamps.push([time, 0]);
    }

    const timestampByBlockNumber: Map<bigint, number> = new Map();

    const findClosestTimeFrame = (
      target: number,
      timestamps: number[][],
    ): number[] => {
      return timestamps.reduce((curr, prev) =>
        Math.abs(curr[0] - target) < Math.abs(prev[0] - target) ? curr : prev,
      );
    };

    for (const event of allEvents) {
      if (!event.args.tokens) continue;

      let timestamp = timestampByBlockNumber.get(event.blockNumber);

      if (!timestamp) {
        const block = await this.explorerService.getBlock(
          chain,
          event.blockNumber,
        );

        if (!block) continue;

        timestamp = Number(block.timestamp);
        timestampByBlockNumber.set(event.blockNumber, timestamp);
      }

      const tokenAmount = formatUnits(event.args.tokens, SRG_DECIMALS);

      const [_, closestPrice] = findClosestTimeFrame(timestamp, priceHistory);
      const [closestsHourly] = findClosestTimeFrame(
        timestamp,
        hourlyTimestamps,
      );

      const hourlyIndex = hourlyTimestamps.findIndex(
        (entry) => entry[0] === closestsHourly,
      );

      if (hourlyIndex === -1) continue;

      const volumeUsd = Number(tokenAmount) * closestPrice;
      hourlyTimestamps[hourlyIndex][1] += volumeUsd;
    }

    return hourlyTimestamps;
  }

  public async getSrgHistory(
    collection: Collection,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: { column: string; ascending?: boolean };
      filters?: Array<{ column: string; operator: string; value: any }>;
    },
  ): Promise<HistoricPrice[]> {
    return await this.supabaseService.getAll<HistoricPrice>({
      collection,
      options,
    });
  }

  public async getSrgCreationBlock(
    chain: ChainName,
    contract: Address,
  ): Promise<Block | null> {
    const transferLogs = await this.explorerService.getLogs({
      chain,
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

  public async getSrg20Contracts({
    chain,
    contract,
  }: {
    chain: ChainName;
    contract: Address;
  }): Promise<Address[]> {
    const logs = await this.explorerService.getLogs({
      chain,
      contract,
      event: TRANSFER_EVENT,
      fromBlock: 'earliest',
    });

    if (!logs) return [];

    const toExternal = logs?.filter(
      (log) => getAddress(log.args.to) !== getAddress(contract),
    );

    const receivers = Array.from(
      new Set(toExternal.map((log) => getAddress(log.args.to))),
    );

    const contracts: Address[] = [];

    for (const address of receivers) {
      const isContract = await this.explorerService.isContract(address, chain);

      if (!isContract) continue;

      contracts.push(address);
    }

    return contracts;
  }
}
