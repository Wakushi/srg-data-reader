import { Injectable, Logger } from '@nestjs/common';
import { ChainName } from 'shared/chains';
import { ExplorerService } from 'src/explorer/explorer.service';
import {
  Abi,
  Address,
  Block,
  formatUnits,
  getAddress,
  PublicClient,
} from 'viem';
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
  SRG20_BUY_SIGNATURE,
  SRG20_SELL_SIGNATURE,
  SRG_CONTRACTS,
  ETH_DECIMALS,
} from '../../shared/constants';
import { SrgHourlyPrice, Srg20HourlyPrice } from './entities/token.types';
import { SupabaseService } from 'src/supabase/supabase.service';
import { Collection } from 'src/supabase/entities/collections.type';
import {
  Srg20ExtractionPayload,
  SrgExtractionPayload,
} from './entities/srg20-extraction.type';
import { findClosestTimeFrame } from 'shared/utils';

const BATCH_SIZE = 100;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private explorerService: ExplorerService,
    private supabaseService: SupabaseService,
  ) {}

  /////////////////////////
  // READ
  /////////////////////////

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

  public async getSrg20VolumeHistory(contract: Address): Promise<number[][]> {
    const history = await this.supabaseService.getTokenHistory(contract);

    if (!history) return [];

    return history.map((metrics) => [metrics.timestamp, metrics.volume]);
  }

  public async getSrg20History(contract: Address): Promise<Srg20HourlyPrice[]> {
    return await this.supabaseService.getTokenHistory(contract);
  }

  public async getSrgHistory(chain: ChainName): Promise<SrgHourlyPrice[]> {
    return await this.supabaseService.getAll<SrgHourlyPrice>(
      Collection.SRG_PRICE_HISTORY,
      {
        column: 'chain',
        value: chain,
      },
    );
  }

  /////////////////////////
  // EXTRACTION
  /////////////////////////

  /////////////////////////
  // MAIN $SRG EXTRACTION
  /////////////////////////

  public async extractSrgHistory({
    chain,
    fromTimestamp,
  }: SrgExtractionPayload): Promise<void> {
    try {
      const contract = SRG_CONTRACTS[chain];

      const hourlyTimestamps = await this.buildHourlyTimeframe({
        chain,
        contract,
        fromTimestamp,
      }); //

      const clients = this.explorerService.getClients(chain);
      const chunkSize = Math.ceil(hourlyTimestamps.length / clients.length);

      for (const clientNode of clients) {
        this.extractSaveSrgHistoryChunk({
          clientNode,
          chain,
          contract,
          hourlyTimestamps: hourlyTimestamps.splice(0, chunkSize),
        })
          .then((batchResults) => {
            // Volume for $SRG ?
          })
          .catch((error) => {
            this.logger.error(
              `Error extraction data (${clientNode.uid}): `,
              error,
            );
          })
          .finally(() => {
            this.logger.log(`Client ${clientNode.uid} finished job!`);
          });
      }
    } catch (error) {
      console.error('Error extracting $SRG: ', error);
    }
  }

  private async extractSaveSrgHistoryChunk({
    clientNode,
    chain,
    contract,
    hourlyTimestamps,
  }: {
    contract: Address;
    clientNode: PublicClient;
    chain: ChainName;
    hourlyTimestamps: number[];
  }): Promise<void> {
    const BATCH_SIZE = 50;
    const MAX_RETRIES = 5;

    const totalBatches = Math.ceil(hourlyTimestamps.length / BATCH_SIZE);

    let batchCounter = 1;
    let retries = 0;

    let batch: number[] = [];

    while (hourlyTimestamps.length > 0) {
      this.logger.log(
        `Processing batch ${batchCounter}/${totalBatches} (${hourlyTimestamps.length} entries remaining)`,
      );

      if (retries == 0) {
        batch = hourlyTimestamps.splice(0, BATCH_SIZE);
      }
      try {
        const results: Omit<SrgHourlyPrice, 'id'>[] = await Promise.all(
          batch.map(async (timestamp) => {
            return await this.extractSrgPrice({
              clientNode,
              timestamp,
              chain,
              contract,
            });
          }),
        );

        await this.supabaseService.batchUpsert<SrgHourlyPrice>({
          collection: Collection.SRG_PRICE_HISTORY,
          items: results,
          options: {
            batchSize: BATCH_SIZE,
            onConflict: 'token_address,chain,timestamp',
            ignoreDuplicates: false,
          },
        });

        retries = 0;
        batchCounter++;
      } catch (error) {
        retries++;

        if (retries > MAX_RETRIES) {
          console.error(`Failed after ${MAX_RETRIES} retries:`, error);
          throw error;
        }

        const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;

        this.logger.warn(
          `Retry attempt ${retries}/${MAX_RETRIES} after error: ${JSON.stringify(error).slice(0, 200)}. Waiting ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async extractSrgPrice({
    timestamp,
    chain,
    contract,
    clientNode,
  }: {
    timestamp: number;
    chain: ChainName;
    contract: Address;
    clientNode?: PublicClient;
  }): Promise<any> {
    const closestBlockNumber =
      await this.explorerService.getBlockNumberByTimestamp({
        chain,
        timestamp,
      });

    const history: SrgHourlyPrice = {
      timestamp,
      chain,
      token_address: contract,
      real_native_balance: 0,
      internal_native_balance: 0,
      native_price_usd: 0,
      srg_balance: 0,
      internal_srg_price_usd: 0,
      real_price_usd: 0,
    };

    if (!closestBlockNumber) return history;

    const rawNativeBalance = await this.explorerService.getBalance({
      chain,
      contract,
      blockNumber: closestBlockNumber,
    });

    const nativeBalance = Number(formatUnits(rawNativeBalance, ETH_DECIMALS));

    const rawSrgBalance: bigint = await this.explorerService.readContract({
      clientNode,
      chain,
      contract,
      abi: IERC20_ABI,
      functionName: 'balanceOf',
      blockNumber: closestBlockNumber,
      args: [contract],
    });

    const srgBalance = Number(formatUnits(rawSrgBalance, SRG_DECIMALS));

    const srgLiquidity: bigint = await this.explorerService.readContract({
      clientNode,
      chain,
      contract,
      abi: SRG_ABI,
      functionName: 'getLiquidity',
      blockNumber: closestBlockNumber,
    });

    const internalNativeBalance = Number(
      formatUnits(srgLiquidity, ETH_DECIMALS),
    );

    const nativePriceUsd = await this.getNativePriceUsd(
      chain,
      closestBlockNumber,
    );

    // 6. Calculate price of $SRG units in ETH/BNB using the tracked balance
    const internalSrgPriceNative = internalNativeBalance / srgBalance;
    // 7. Calculate $SRG internal unit price in USD
    const internalSrgPriceUsd = internalSrgPriceNative * nativePriceUsd;

    // 8. Calculate price of $SRG units in ETH/BNB using real balance
    const realSrgPriceNative = nativeBalance / srgBalance;
    // 9. Calculate $SRG unit price in USD
    const realSrgPriceUsd = realSrgPriceNative * nativePriceUsd;

    history.real_native_balance = nativeBalance;
    history.internal_native_balance = internalNativeBalance;
    history.native_price_usd = nativePriceUsd;
    history.srg_balance = Number(srgBalance);
    history.internal_srg_price_usd = internalSrgPriceUsd;
    history.real_price_usd = realSrgPriceUsd;

    return history;
  }

  /////////////////////////
  // SRG20s EXTRACTION
  /////////////////////////

  public async extractSrg20History({
    contract,
    chain,
    fromTimestamp,
  }: Srg20ExtractionPayload): Promise<void> {
    try {
      const srgHistory = await this.getSrgHistory(chain);

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

      this.logger.log(`Extracting data for $${tokenName}`);

      const hourlyTimestamps = await this.buildHourlyTimeframe({
        chain,
        contract,
        fromTimestamp,
      });

      const clients = this.explorerService.getClients(chain);
      const chunkSize = Math.ceil(hourlyTimestamps.length / clients.length);

      for (const clientNode of clients) {
        this.extractSaveSrg20HistoryChunk({
          clientNode,
          chain,
          contract,
          srgHistory,
          hourlyTimestamps: hourlyTimestamps.splice(0, chunkSize),
        })
          .then((batchResults) => {
            this.extractAppendVolume(batchResults, chain);
          })
          .catch((error) => {
            this.logger.error(
              `Error extraction data (${clientNode.uid}): `,
              error,
            );
          })
          .finally(() => {
            this.logger.log(`Client ${clientNode.uid} finished job!`);
          });
      }
    } catch (error) {
      console.error('Error extracting SRG20: ', error);
    }
  }

  private async extractSaveSrg20HistoryChunk({
    clientNode,
    chain,
    contract,
    srgHistory,
    hourlyTimestamps,
  }: {
    clientNode: PublicClient;
    chain: ChainName;
    contract: Address;
    srgHistory: SrgHourlyPrice[];
    hourlyTimestamps: number[];
  }): Promise<Omit<Srg20HourlyPrice, 'id'>[]> {
    const MAX_RETRIES = 5;

    const totalBatches = Math.ceil(hourlyTimestamps.length / BATCH_SIZE);

    let batchCounter = 1;
    let retries = 0;

    let batch: number[] = [];
    const results: Srg20HourlyPrice[] = [];

    while (hourlyTimestamps.length > 0 && retries <= MAX_RETRIES) {
      this.logger.log(
        `RPC ${clientNode.uid} - Processing batch ${batchCounter}/${totalBatches} (${hourlyTimestamps.length} entries remaining)`,
      );

      if (retries == 0) {
        batch = hourlyTimestamps.splice(0, BATCH_SIZE);
      }

      try {
        const batchResults: Omit<Srg20HourlyPrice, 'id'>[] = await Promise.all(
          batch.map(async (timestamp) => {
            return await this.extractSrg20Price({
              clientNode,
              srgHistory,
              timestamp,
              chain,
              contract,
            });
          }),
        );

        const insertedResults =
          await this.supabaseService.batchUpsert<Srg20HourlyPrice>({
            collection: Collection.TOKEN_PRICE_HISTORY,
            items: batchResults,
            options: {
              batchSize: BATCH_SIZE,
              onConflict: 'token_address,chain,timestamp',
              ignoreDuplicates: false,
            },
          });

        results.push(...insertedResults);

        retries = 0;
        batchCounter++;
      } catch (error) {
        retries++;

        if (retries > MAX_RETRIES) {
          console.error(`Failed after ${MAX_RETRIES} retries:`, error);
          throw error;
        }

        const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;

        this.logger.warn(
          `Retry attempt ${retries}/${MAX_RETRIES} after error: ${JSON.stringify(error).slice(0, 200)}. Waiting ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return results;
  }

  private async extractSrg20Price({
    srgHistory,
    timestamp,
    chain,
    contract,
    clientNode,
  }: {
    srgHistory: SrgHourlyPrice[];
    timestamp: number;
    chain: ChainName;
    contract: Address;
    clientNode?: PublicClient;
  }): Promise<Srg20HourlyPrice> {
    const closestBlockNumber =
      await this.explorerService.getBlockNumberByTimestamp({
        chain,
        timestamp,
      });

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
      volume: 0,
    };

    if (!closestBlockNumber) return history;

    const rawSrg20Balance: bigint = await this.explorerService.readContract({
      clientNode,
      chain,
      contract,
      abi: IERC20_ABI,
      functionName: 'balanceOf',
      blockNumber: closestBlockNumber,
      args: [contract],
    });

    const srg20Balance = Number(formatUnits(rawSrg20Balance, SRG_DECIMALS));

    const rawSrgBalance: bigint = await this.explorerService.readContract({
      clientNode,
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

  /////////////////////////
  // VOLUME EXTRACTION
  /////////////////////////

  private async extractAppendVolume(
    history: Srg20HourlyPrice[],
    chain: ChainName,
  ): Promise<void> {
    const contract = history[0].token_address;

    this.logger.log(
      `Appending volume and saving ${history.length} extracted results for token ${contract}..`,
    );

    const priceHistory = history.map((metrics) => [
      metrics.timestamp,
      metrics.real_price_usd,
    ]);

    const volumeHistory = await this.extractSrg20VolumeHistory({
      contract,
      chain,
      history: priceHistory,
    });

    const completedResults = history.map((hourly) => {
      const [_, volume] = findClosestTimeFrame(hourly.timestamp, volumeHistory);

      return { ...hourly, volume };
    });

    await this.supabaseService.batchUpsert<Srg20HourlyPrice>({
      collection: Collection.TOKEN_PRICE_HISTORY,
      items: completedResults,
      options: {
        batchSize: BATCH_SIZE,
        onConflict: 'token_address,chain,timestamp',
        ignoreDuplicates: false,
        progressLabel: 'hourly prices',
      },
    });

    this.logger.log(`Saved ${history.length} results!`);
  }

  public async extractSrg20VolumeHistory({
    contract,
    chain,
    history,
  }: {
    contract: Address;
    chain: ChainName;
    history?: number[][];
  }): Promise<number[][]> {
    let priceHistory = history
      ? history
      : await this.getSrg20PriceHistory(contract);

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

  public async syncVolumeHistory(
    contract: Address,
    chain: ChainName,
  ): Promise<void> {
    const history = await this.getSrg20History(contract);

    if (!history) {
      throw new Error(`No history recorded for token ${contract} on ${chain}`);
    }

    await this.extractAppendVolume(history, chain);
  }

  /////////////////////////
  // HELPERS
  /////////////////////////

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

  public async getNativePriceUsd(
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

  public async getSrg20Contracts(chain: ChainName): Promise<Address[]> {
    const contract = SRG_CONTRACTS[chain];

    const logs = await this.explorerService.getLogs({
      chain,
      contract,
      event: TRANSFER_EVENT,
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

      const implementsSrg20 = await this.isSRG20Contract(address, chain);

      if (!implementsSrg20) continue;

      contracts.push(address);
    }

    return contracts;
  }

  public async isSRG20Contract(
    address: Address,
    chain: ChainName,
  ): Promise<boolean> {
    try {
      const bytecode = await this.explorerService.getBytecode(address, chain);

      if (!bytecode) return false;

      const hasBuyMethod = bytecode.includes(SRG20_BUY_SIGNATURE.slice(2, 10));
      const hasSellMethod = bytecode.includes(
        SRG20_SELL_SIGNATURE.slice(2, 10),
      );

      let hasSRG20Properties = false;

      try {
        const minimalSRG20Abi: Abi = [
          {
            inputs: [],
            name: 'calculatePrice',
            outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function',
          },
          {
            inputs: [],
            name: 'getLiquidity',
            outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function',
          },
        ];

        await this.explorerService.readContract({
          chain,
          contract: address as `0x${string}`,
          abi: minimalSRG20Abi,
          functionName: 'calculatePrice',
        });

        await this.explorerService.readContract({
          chain,
          contract: address as `0x${string}`,
          abi: minimalSRG20Abi,
          functionName: 'getLiquidity',
        });

        hasSRG20Properties = true;
      } catch (error) {
        hasSRG20Properties = false;
      }

      return hasBuyMethod && hasSellMethod && hasSRG20Properties;
    } catch (error) {
      console.error('Error checking if contract is SRG20: ', error);
      return false;
    }
  }

  private async buildHourlyTimeframe({
    chain,
    contract,
    fromTimestamp,
  }: {
    chain: ChainName;
    contract: Address;
    fromTimestamp?: number;
  }): Promise<number[]> {
    let firstBlock: Block | null = null;

    if (fromTimestamp) {
      const blockNumber = await this.explorerService.getBlockNumberByTimestamp({
        chain,
        timestamp: fromTimestamp,
      });

      firstBlock = await this.explorerService.getBlock(chain, blockNumber);
    } else {
      firstBlock = await this.getSrgCreationBlock(chain, contract);
    }

    const lastBlock = await this.explorerService.getBlock(chain);

    if (!firstBlock || !lastBlock) {
      throw new Error('Missing block information, unable to build timeframe.');
    }

    const startTime = Number(firstBlock.timestamp);
    const endTime = Number(lastBlock.timestamp);

    const hourlyTimestamps: number[] = [];

    for (let time = startTime; time <= endTime; time += ONE_HOUR_IN_SECOND) {
      hourlyTimestamps.push(time);
    }

    return hourlyTimestamps;
  }
}
