import { Injectable, Logger } from '@nestjs/common';
import { ChainName } from 'shared/chains';
import { ExplorerService } from 'src/explorer/explorer.service';
import { Abi, Address, Block, formatUnits, getAddress } from 'viem';
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
  WETH_USDC_ARB_POOL,
  WBNB_USDT_POOL,
  ALCHEMY_RATE_LIMIT_ERROR_CODE,
  QUICK_NODE_RATE_LIMIT_ERROR_CODE,
} from '../../shared/constants';
import { SrgHourlyPrice, Srg20HourlyPrice } from './entities/token.types';
import { SupabaseService } from 'src/supabase/supabase.service';
import { Collection } from 'src/supabase/entities/collections.type';
import {
  Srg20ExtractionPayload,
  SrgExtractionPayload,
} from './entities/srg20-extraction.type';
import { findClosestTimeFrame } from 'shared/utils';
import { RpcClient, RpcClientService } from 'src/rpc-client/rpc-client.service';
import { PANCAKE_SWAP_POOL_ABI } from 'shared/abis/pancake-swap-pool.abi';

const BATCH_SIZE = 100;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly explorerService: ExplorerService,
    private readonly supabaseService: SupabaseService,
    private readonly rpcClientService: RpcClientService,
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
    const history = await this.supabaseService.getAll<SrgHourlyPrice>(
      Collection.SRG_PRICE_HISTORY,
      {
        column: 'chain',
        value: chain,
      },
    );

    return history.sort((a, b) => a.timestamp - b.timestamp);
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
    fromBlockNumber,
  }: SrgExtractionPayload): Promise<void> {
    const contract = SRG_CONTRACTS[chain];

    const hourlyTimestamps = await this.buildHourlyTimeframe({
      chain,
      contract,
      fromTimestamp,
      fromBlockNumber,
    });

    let batchCounter = 1;
    let batch: number[] = [];

    let rpcClient = this.rpcClientService.getClient(chain);

    while (hourlyTimestamps.length > 0) {
      this.logger.log(
        `Client: ${rpcClient.client.transport.name} | Max size ${rpcClient.batchSize} | (${hourlyTimestamps.length} entries remaining)`,
      );

      batch = hourlyTimestamps.splice(0, rpcClient.batchSize);
      batch.sort((a, b) => a - b);

      try {
        const results: Omit<SrgHourlyPrice, 'id'>[] = await Promise.all(
          batch.map(async (timestamp) => {
            return await this.extractSrgPrice({
              rpcClient,
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

        this.rpcClientService.recordSuccess(rpcClient);

        batchCounter++;
      } catch (error) {
        const delay = Math.random() * 100 + 1000;
        const errorCode = error?.code || error?.cause?.cause?.code || null;

        if (
          errorCode === ALCHEMY_RATE_LIMIT_ERROR_CODE ||
          errorCode === QUICK_NODE_RATE_LIMIT_ERROR_CODE
        ) {
          this.logger.log(
            `${rpcClient.client.transport.name} failed (${errorCode}) | Waiting ${delay}ms...`,
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        this.rpcClientService.recordFailure(rpcClient);

        hourlyTimestamps.push(...batch);
        rpcClient = this.rpcClientService.getClient(chain);
      }
    }
  }

  private async extractSrgPrice({
    timestamp,
    chain,
    contract,
    rpcClient,
  }: {
    timestamp: number;
    chain: ChainName;
    contract: Address;
    rpcClient: RpcClient;
  }): Promise<any> {
    const closestBlockNumber = await this.explorerService.findNearestBlock({
      chain,
      targetTimestamp: timestamp,
      rpcClient,
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

    if (!rawNativeBalance) return history;

    const nativeBalance = Number(formatUnits(rawNativeBalance, ETH_DECIMALS));

    const rawSrgBalance: bigint = await this.explorerService.readContract({
      rpcClient,
      chain,
      contract,
      abi: IERC20_ABI,
      functionName: 'balanceOf',
      blockNumber: closestBlockNumber,
      args: [contract],
    });

    const srgBalance = Number(formatUnits(rawSrgBalance, SRG_DECIMALS));

    const srgLiquidity: bigint = await this.explorerService.readContract({
      rpcClient,
      chain,
      contract,
      abi: SRG_ABI,
      functionName: 'getLiquidity',
      blockNumber: closestBlockNumber,
    });

    const internalNativeBalance = Number(
      formatUnits(srgLiquidity, ETH_DECIMALS),
    );

    const nativePriceUsd = await this.getNativePriceUsd({
      rpcClient,
      chain,
      blockNumber: closestBlockNumber,
    });

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

      let rpcClient = this.rpcClientService.getClient(chain);

      const tokenName = await this.explorerService.readContract({
        rpcClient,
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
        rpcClient,
        fromTimestamp: fromTimestamp || srgHistory[0].timestamp,
      });

      let batchCounter = 1;
      let batch: number[] = [];

      while (hourlyTimestamps.length > 0) {
        this.logger.log(
          `Client: ${rpcClient.client.transport.name} | Max size ${rpcClient.batchSize} | (${hourlyTimestamps.length} entries remaining)`,
        );

        batch = hourlyTimestamps.splice(0, rpcClient.batchSize);
        batch.sort((a, b) => a - b);

        try {
          const batchResults: Omit<Srg20HourlyPrice, 'id'>[] =
            await Promise.all(
              batch.map(async (timestamp) => {
                return await this.extractSrg20Price({
                  rpcClient,
                  srgHistory,
                  timestamp,
                  chain,
                  contract,
                });
              }),
            );

          const filteredResults = batchResults.filter(
            (result) => result.token_balance,
          );

          await this.supabaseService.batchUpsert<Srg20HourlyPrice>({
            collection: Collection.TOKEN_PRICE_HISTORY,
            items: filteredResults,
            options: {
              batchSize: BATCH_SIZE,
              onConflict: 'token_address,chain,timestamp',
              ignoreDuplicates: false,
            },
          });

          this.rpcClientService.recordSuccess(rpcClient);

          batchCounter++;
        } catch (error) {
          const delay = Math.random() * 100 + 1000;
          const errorCode =
            error?.code || error?.cause?.cause?.code || error.status || null;

          if (
            errorCode === ALCHEMY_RATE_LIMIT_ERROR_CODE ||
            errorCode === QUICK_NODE_RATE_LIMIT_ERROR_CODE
          ) {
            this.logger.log(
              `${rpcClient.client.transport.name} failed (${errorCode}) | Waiting ${delay}ms...`,
            );

            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          this.rpcClientService.recordFailure(rpcClient);

          hourlyTimestamps.push(...batch);
          rpcClient = this.rpcClientService.getClient(chain);
        }
      }
    } catch (error) {
      console.error('Error extracting SRG20: ', error);
    }
  }

  private async extractSrg20Price({
    srgHistory,
    timestamp,
    chain,
    contract,
    rpcClient,
  }: {
    srgHistory: SrgHourlyPrice[];
    timestamp: number;
    chain: ChainName;
    contract: Address;
    rpcClient: RpcClient;
  }): Promise<Srg20HourlyPrice> {
    const closestBlockNumber = await this.explorerService.findNearestBlock({
      chain,
      targetTimestamp: timestamp,
      rpcClient,
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

    const rawSrg20Balance: bigint | null =
      await this.explorerService.readContract({
        rpcClient,
        chain,
        contract,
        abi: IERC20_ABI,
        functionName: 'balanceOf',
        blockNumber: closestBlockNumber,
        args: [contract],
      });

    if (!rawSrg20Balance) return history;

    const decimals: bigint = await this.explorerService.readContract({
      rpcClient,
      chain,
      contract,
      abi: SRG_ABI,
      functionName: 'decimals',
      blockNumber: closestBlockNumber,
    });

    const srg20Balance = Number(formatUnits(rawSrg20Balance, Number(decimals)));

    const rawSrgBalance: bigint = await this.explorerService.readContract({
      rpcClient,
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

  public async getNativePriceUsd({
    rpcClient,
    chain,
    blockNumber,
  }: {
    rpcClient: RpcClient;
    chain: ChainName;
    blockNumber?: bigint;
  }): Promise<any> {
    const pools: Record<ChainName, Address> = {
      [ChainName.ETHEREUM]: WETH_USDC_POOL,
      [ChainName.BSC]: WBNB_USDT_POOL,
      [ChainName.ARBITRUM]: WETH_USDC_ARB_POOL,
    };

    if (chain == ChainName.BSC) {
      try {
        const reserves = await this.explorerService.readContract({
          rpcClient,
          chain,
          contract: pools[chain],
          abi: PANCAKE_SWAP_POOL_ABI,
          functionName: 'getReserves',
          blockNumber,
        });

        if (!reserves) {
          throw new Error('Failed to fetch data from Pancake swap pool');
        }

        const [reserve0, reserve1] = reserves;

        const nativePriceInUSD = Number(reserve0) / Number(reserve1);

        return nativePriceInUSD;
      } catch (error) {
        throw error;
      }
    }

    try {
      const slot0Data = await this.explorerService.readContract({
        rpcClient,
        chain,
        contract: pools[chain],
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
      const nativePriceInUSD = 1 / (priceRatio / 10 ** 12);

      return nativePriceInUSD;
    } catch (error) {
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

      const rpcClient = this.rpcClientService.getClient(chain);

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
          rpcClient,
          chain,
          contract: address as `0x${string}`,
          abi: minimalSRG20Abi,
          functionName: 'calculatePrice',
        });

        await this.explorerService.readContract({
          rpcClient,
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
    fromBlockNumber,
    rpcClient,
  }: {
    chain: ChainName;
    contract: Address;
    fromTimestamp?: number;
    fromBlockNumber?: bigint;
    rpcClient?: RpcClient;
  }): Promise<number[]> {
    const hourlyTimestamps: number[] = [];

    const lastBlock = await this.explorerService.getBlock(chain);

    if (!lastBlock) {
      throw new Error('Missing block information, unable to build timeframe.');
    }

    const endTime = Number(lastBlock.timestamp);

    if (!fromTimestamp && !fromBlockNumber) {
      const tokenMetadata =
        await this.supabaseService.getTokenMetadata(contract);

      if (tokenMetadata?.deployed_at) {
        const startTime = tokenMetadata?.deployed_at;

        if (!lastBlock) {
          throw new Error(
            'Missing block information, unable to build timeframe.',
          );
        }

        for (
          let time = startTime;
          time <= endTime;
          time += ONE_HOUR_IN_SECOND
        ) {
          hourlyTimestamps.push(time);
        }

        return hourlyTimestamps;
      }
    }

    let firstBlock: Block | null = null;

    if (!fromTimestamp && !fromBlockNumber) {
      firstBlock = await this.getSrgCreationBlock({ chain, contract });

      await this.supabaseService.saveTokenMetadata({
        token_address: contract,
        chain,
        deployed_at: Number(firstBlock?.timestamp),
      });
    }

    if (fromTimestamp && rpcClient) {
      const blockNumber = await this.explorerService.findNearestBlock({
        chain,
        targetTimestamp: fromTimestamp,
        rpcClient,
      });

      firstBlock = await this.explorerService.getBlock(chain, blockNumber);
    }

    if (fromBlockNumber) {
      firstBlock = await this.explorerService.getBlock(chain, fromBlockNumber);
    }

    if (!firstBlock) {
      throw new Error('Missing block information, unable to build timeframe.');
    }

    const startTime = Number(firstBlock.timestamp);

    for (let time = startTime; time <= endTime; time += ONE_HOUR_IN_SECOND) {
      hourlyTimestamps.push(time);
    }

    return hourlyTimestamps;
  }

  private async getSrgCreationBlock({
    chain,
    contract,
  }: {
    chain: ChainName;
    contract: Address;
  }): Promise<Block | null> {
    const transferLogs = await this.explorerService.getLogs({
      chain,
      contract: contract,
      event: TRANSFER_EVENT,
    });

    if (!transferLogs || !transferLogs.length) return null;

    const block = await this.explorerService.getBlock(
      chain,
      transferLogs[0].blockNumber,
    );

    return block;
  }
}
