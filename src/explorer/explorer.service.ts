import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChainName } from 'shared/chains';
import {
  ALCHEMY_RATE_LIMIT_ERROR_CODE,
  CHAIN_BLOCK_TIMES,
  QUICK_NODE_RATE_LIMIT_ERROR_CODE,
} from 'shared/constants';
import { RpcClient, RpcClientService } from 'src/rpc-client/rpc-client.service';
import { LogEvent } from 'src/token/entities/token.types';
import {
  Abi,
  AbiEvent,
  Address,
  Block,
  BlockTag,
  GetBalanceParameters,
  GetCodeReturnType,
  ReadContractParameters,
} from 'viem';
import { RpcError } from 'shared/rpc-errors';

type BlockRange = { fromBlock: bigint; toBlock: bigint };

@Injectable()
export class ExplorerService {
  private readonly logger = new Logger(ExplorerService.name);

  constructor(
    @Inject('EXPLORER_CONFIG')
    private readonly config: { apiKey: string },
    private readonly rpcClientService: RpcClientService,
  ) {}

  public async getBalance({
    chain,
    contract,
    blockNumber,
  }: {
    chain: ChainName;
    contract: Address;
    blockNumber?: bigint | null;
  }): Promise<bigint | null> {
    let retries = 0;
    const MAX_RETRIES = 10;

    let rpClient = this.rpcClientService.getClient(chain);

    while (retries <= MAX_RETRIES) {
      try {
        const balanceParams: GetBalanceParameters = {
          address: contract,
          ...(blockNumber ? { blockNumber } : {}),
        };

        return await rpClient.client.getBalance(balanceParams);
      } catch (error) {
        retries++;
        rpClient = this.rpcClientService.getClient(chain);
      }
    }

    return null;
  }

  public async getLogs({
    chain,
    contract,
    event,
    fromTimestamp,
    fromBlock = 0n,
  }: {
    chain: ChainName;
    contract: Address;
    event: AbiEvent;
    fromTimestamp?: number;
    fromBlock?: bigint | BlockTag;
  }): Promise<LogEvent[]> {
    let rpcClient = this.rpcClientService.getClient(chain);

    const latestBlock = await rpcClient.client.getBlockNumber();
    let startBlock = typeof fromBlock === 'bigint' ? fromBlock : 0n;

    const rangeSize = 499n;

    const blockRanges: BlockRange[] = [];

    while (startBlock <= latestBlock) {
      const endBlock =
        startBlock + rangeSize > latestBlock
          ? latestBlock
          : startBlock + rangeSize;

      blockRanges.push({
        fromBlock: startBlock,
        toBlock: endBlock,
      });

      startBlock = endBlock + 1n;
    }

    const completeResults: LogEvent[] = [];

    let batchCounter = 1;
    let batch: BlockRange[] = [];

    while (blockRanges.length > 0) {
      this.logger.log(
        `Client: ${rpcClient.client.transport.name} | Max size ${rpcClient.batchSize} | (${blockRanges.length} entries remaining)`,
      );

      batch = blockRanges.splice(0, rpcClient.batchSize);

      try {
        const logs = await Promise.all(
          batch.map(async ({ fromBlock, toBlock }) => {
            const results = await rpcClient.client.getLogs({
              address: contract,
              event,
              fromBlock,
              toBlock,
            });

            return results as unknown as LogEvent;
          }),
        );

        completeResults.push(...logs.flat());

        batchCounter++;
      } catch (error) {
        const delay = Math.random() * 100 + 1000;

        if (
          error?.code === ALCHEMY_RATE_LIMIT_ERROR_CODE ||
          error?.code === QUICK_NODE_RATE_LIMIT_ERROR_CODE
        ) {
          this.logger.log(
            `${rpcClient.client.transport.name} failed (${error?.code}) | Waiting ${delay}ms...`,
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        blockRanges.push(...batch);
        rpcClient = this.rpcClientService.getClient(chain);
      }
    }

    const results = completeResults.sort(
      (a, b) => Number(a.blockNumber) - Number(b.blockNumber),
    );

    return results;
  }

  public async getBlock(
    chain: ChainName,
    blockNumber?: bigint | null,
  ): Promise<Block | null> {
    let block: Block | null = null;
    let rpcClient = this.rpcClientService.getClient(chain);

    while (!block) {
      try {
        block = await rpcClient.client.getBlock(
          blockNumber ? { blockNumber } : {},
        );
      } catch (error) {
        rpcClient = this.rpcClientService.getClient(chain);
      }
    }

    return block;
  }

  public async readContract({
    contract,
    abi,
    functionName,
    blockNumber,
    args,
    rpcClient,
  }: {
    chain: ChainName;
    contract: Address;
    abi: Abi;
    functionName: string;
    blockNumber?: bigint;
    args?: any;
    rpcClient: RpcClient;
  }): Promise<any> {
    try {
      const payload: ReadContractParameters = {
        address: contract,
        abi,
        functionName,
      };

      if (blockNumber) {
        payload.blockNumber = blockNumber;
      }

      if (args) {
        payload.args = args;
      }

      const data = await rpcClient.client.readContract(payload);

      return data;
    } catch (error) {
      if (error?.cause?.name === RpcError.ContractFunctionZeroDataError) {
        return null;
      }

      throw new Error(error);
    }
  }

  public async isContract(
    address: Address,
    chain: ChainName,
  ): Promise<boolean> {
    try {
      const bytecode = await this.getBytecode(address, chain);

      return bytecode ? bytecode !== '0x' : false;
    } catch (error) {
      return false;
    }
  }

  public async getBytecode(
    address: Address,
    chain: ChainName,
  ): Promise<GetCodeReturnType> {
    try {
      const rpcClient = this.rpcClientService.getClient(chain);

      const bytecode = await rpcClient.client.getCode({
        address: address as `0x${string}`,
      });

      return bytecode;
    } catch (error) {
      console.log('Error getting byte code: ', error);
    }
  }

  public async findNearestBlock({
    targetTimestamp,
    higherLimitStamp,
    rpcClient,
    chain,
  }: {
    targetTimestamp: number;
    higherLimitStamp?: number;
    rpcClient: RpcClient;
    chain: ChainName;
  }): Promise<bigint> {
    if (chain === ChainName.ARBITRUM) {
      return await this.getBlockNumberByTimestamp(chain, targetTimestamp);
    }

    const averageBlockTime = CHAIN_BLOCK_TIMES[chain];

    const currentBlockNumber = await rpcClient.client.getBlockNumber();
    let blockNumber = currentBlockNumber;
    let block = await rpcClient.client.getBlock({ blockNumber });
    let requestsMade = 0;

    while (Number(block.timestamp) > targetTimestamp) {
      let decreaseBlocks =
        (Number(block.timestamp) - targetTimestamp) / averageBlockTime;
      decreaseBlocks = Math.floor(decreaseBlocks);

      if (decreaseBlocks < 1) {
        break;
      }

      blockNumber = blockNumber - BigInt(decreaseBlocks); // -40887775n
      block = await rpcClient.client.getBlock({ blockNumber });
      requestsMade += 1;
    }

    if (higherLimitStamp) {
      if (Number(block.timestamp) >= higherLimitStamp) {
        while (Number(block.timestamp) >= higherLimitStamp) {
          blockNumber = blockNumber - BigInt(1);
          block = await rpcClient.client.getBlock({ blockNumber });
          requestsMade += 1;
        }
      }

      if (Number(block.timestamp) < higherLimitStamp) {
        while (Number(block.timestamp) < higherLimitStamp) {
          const nextBlockNumber = blockNumber + BigInt(1);

          if (nextBlockNumber > currentBlockNumber) break;

          const tempBlock = await rpcClient.client.getBlock({
            blockNumber: nextBlockNumber,
          });

          if (Number(tempBlock.timestamp) >= higherLimitStamp) {
            break;
          }

          block = tempBlock;
          blockNumber = nextBlockNumber;
          requestsMade += 1;
        }
      }
    }

    return block.number;
  }

  public async getBlockNumberByTimestamp(
    chain: ChainName,
    timestamp: number,
  ): Promise<any> {
    const alchemyChain: Record<ChainName, string> = {
      [ChainName.ETHEREUM]: 'eth-mainnet',
      [ChainName.ARBITRUM]: 'arb-mainnet',
      [ChainName.BSC]: 'bnb-mainnet',
    };

    let blockNumber: number | null = null;
    const date = new Date(timestamp * 1000);
    const url = `https://api.g.alchemy.com/data/v1/${this.config.apiKey}/utility/blocks/by-timestamp?networks=${alchemyChain[chain]}&timestamp=${date.toISOString()}&direction=AFTER`;

    while (blockNumber === null) {
      try {
        const response = await fetch(url);

        const { data, error } = await response.json();

        if (error) {
          throw new Error('Alchemy API error');
        }

        return data[0].block.number;
      } catch (error) {
        const delay = Math.random() * 100 + 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return blockNumber;
  }
}
