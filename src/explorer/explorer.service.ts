import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChainName } from 'shared/chains';
import {
  ALCHEMY_RATE_LIMIT_ERROR_CODE,
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
import Moralis from 'moralis';

type BlockRange = { fromBlock: bigint; toBlock: bigint };

@Injectable()
export class ExplorerService {
  private readonly logger = new Logger(ExplorerService.name);

  constructor(
    @Inject('EXPLORER_CONFIG')
    private readonly config: { apiKey: string },
    private readonly rpcClientService: RpcClientService,
  ) {
    Moralis.start({
      apiKey: this.config.apiKey,
    });
  }

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
    fromBlock = 0n,
  }: {
    chain: ChainName;
    contract: Address;
    event: AbiEvent;
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

  public async getBlockNumberByTimestamp({
    chain,
    timestamp,
  }: {
    chain: ChainName;
    timestamp: number;
  }): Promise<any> {
    const moralisChain: Record<ChainName, string> = {
      [ChainName.ETHEREUM]: '0x1',
      [ChainName.ARBITRUM]: '0xa4b1',
      [ChainName.BSC]: '0x38',
    };

    let blockNumber: bigint | null = null;

    while (blockNumber == null) {
      try {
        const response = await Moralis.EvmApi.block.getDateToBlock({
          chain: moralisChain[chain],
          date: new Date(timestamp * 1000),
        });

        blockNumber = BigInt(response.raw.block);
      } catch (error) {
        this.logger.error('Error getting block by timestamp..');
        const delay = Math.random() * 100 + 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return blockNumber;
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
}
