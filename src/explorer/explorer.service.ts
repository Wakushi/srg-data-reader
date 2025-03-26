import { Inject, Injectable } from '@nestjs/common';
import { ChainName } from 'shared/chains';
import { RpcUrlConfig } from 'shared/rpc-url-config.type';
import { getChainByName } from 'shared/utils';
import { LogEvent } from 'src/token/entities/token.types';
import {
  Abi,
  AbiEvent,
  Address,
  Block,
  BlockTag,
  createPublicClient,
  GetBalanceParameters,
  GetCodeReturnType,
  http,
  PublicClient,
  ReadContractParameters,
} from 'viem';

@Injectable()
export class ExplorerService {
  constructor(
    @Inject('EXPLORER_CONFIG')
    private readonly config: { rpcUrls: RpcUrlConfig; apiKey: string },
  ) {}

  private _clientsByChain: Map<ChainName, PublicClient[]> = new Map();

  public async getBalance({
    chain,
    contract,
    blockNumber,
  }: {
    chain: ChainName;
    contract: Address;
    blockNumber?: bigint | null;
  }): Promise<bigint> {
    const client = this.getClient(chain);

    const balanceParams: GetBalanceParameters = {
      address: contract,
      ...(blockNumber ? { blockNumber } : {}),
    };

    const balance = await client.getBalance(balanceParams);

    return balance;
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
    try {
      const client = this.getClient(chain);
      const allLogs: any[] = [];

      if (
        chain === ChainName.BSC &&
        (fromBlock === 0n || fromBlock === 'earliest')
      ) {
        const latestBlock = await client.getBlockNumber();

        const chunkSize = 100000n;
        let startBlock = typeof fromBlock === 'bigint' ? fromBlock : 0n;

        const totalChunkCount = (latestBlock - startBlock) / chunkSize;
        let chunkCount = 0;

        while (startBlock <= latestBlock) {
          const endBlock =
            startBlock + chunkSize > latestBlock
              ? latestBlock
              : startBlock + chunkSize;

          console.log(
            `Processing ${chunkCount}/${totalChunkCount} (R: ${startBlock} <-> ${endBlock})`,
          );

          try {
            const chunkLogs = await client.getLogs({
              address: contract,
              event,
              fromBlock: startBlock,
              toBlock: endBlock,
            });

            if (chunkLogs.length) {
              console.log('Logs chunked ', chunkLogs.length);
            }

            allLogs.push(...chunkLogs);

            startBlock = endBlock + 1n;
            chunkCount++;
          } catch (error) {
            console.error(
              `Error getting logs for block range ${startBlock}-${endBlock}: ${error}`,
            );
          }
        }
      } else {
        const logs = await client.getLogs({
          address: contract,
          event,
          fromBlock,
        });

        allLogs.push(...logs);
      }

      allLogs.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));

      return allLogs;
    } catch (error) {
      console.error('Error getting logs ' + error);
      return [];
    }
  }

  public async getBlock(
    chain: ChainName,
    blockNumber?: bigint | null,
  ): Promise<Block | null> {
    try {
      const client = this.getClient(chain);

      const block: Block = await client.getBlock(
        blockNumber ? { blockNumber } : {},
      );

      return block;
    } catch (error) {
      console.log('Error fetching block ' + error);
      return null;
    }
  }

  public async getBlockNumberByTimestamp({
    chain,
    timestamp,
    maxRetries = 5,
    initialDelay = 1000,
  }: {
    chain: ChainName;
    timestamp: number;
    maxRetries?: number;
    initialDelay?: number;
  }): Promise<any> {
    const alchemyChain: Record<ChainName, string> = {
      [ChainName.ETHEREUM]: 'eth-mainnet',
      [ChainName.ARBITRUM]: 'arb-mainnet',
      [ChainName.BSC]: 'bnb-mainnet',
    };

    let retries = 0;
    let delay = initialDelay;

    while (retries <= maxRetries) {
      try {
        const response = await fetch(
          `https://api.g.alchemy.com/data/v1/${this.config.apiKey}/utility/blocks/by-timestamp?networks=${alchemyChain[chain]}&timestamp=${timestamp}&direction=AFTER`,
        );

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error('Rate limit exceeded');
          }

          if (response.status >= 500) {
            throw new Error(`Server error: ${response.status}`);
          }
        }

        const { data } = await response.json();

        if (!data || !data[0] || !data[0].block) {
          throw new Error('Invalid response format from API');
        }

        return data[0].block.number;
      } catch (error) {
        retries++;

        if (retries > maxRetries) {
          console.error(`Failed after ${maxRetries} retries:`, error);
          throw error;
        }

        console.warn(
          `Retry attempt ${retries}/${maxRetries} after error: ${error}. Waiting ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));

        delay = delay * 2 * (0.9 + Math.random() * 0.2);
      }
    }
  }

  public async readContract({
    chain,
    contract,
    abi,
    functionName,
    blockNumber,
    args,
    clientNode,
  }: {
    chain: ChainName;
    contract: Address;
    abi: Abi;
    functionName: string;
    blockNumber?: bigint;
    args?: any;
    clientNode?: PublicClient;
  }): Promise<any> {
    const payload: ReadContractParameters = {
      address: contract,
      abi,
      functionName,
    };

    try {
      const client = clientNode ? clientNode : this.getClient(chain);

      if (blockNumber) {
        payload.blockNumber = blockNumber;
      }

      if (args) {
        payload.args = args;
      }

      const data = await client.readContract(payload);

      return data;
    } catch (error) {
      const errorMsg = `Error reading contract with ${functionName}() payload ${JSON.stringify(payload)}`;
      throw new Error(errorMsg + ' ' + error);
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
      const client = this.getClient(chain);

      const bytecode = await client.getCode({
        address: address as `0x${string}`,
      });

      return bytecode;
    } catch (error) {
      console.log('Error getting byte code: ', error);
    }
  }

  public getClient(chain: ChainName): PublicClient {
    const clients = this.getClients(chain);

    if (!clients || !clients.length) {
      throw new Error('No clients found for chain ' + chain);
    }

    return clients[0];
  }

  public getClients(chainName: ChainName): PublicClient[] {
    const clients = this._clientsByChain.get(chainName);

    if (clients) return clients;

    try {
      const rpcUrls = this.config.rpcUrls[chainName];

      if (!rpcUrls || !rpcUrls.length) {
        throw new Error('Missing RPCs for chain ' + chainName);
      }

      const chain = getChainByName(chainName);

      const newClients = rpcUrls.map((url) => {
        return createPublicClient({
          chain,
          transport: http(url),
        });
      });

      this._clientsByChain.set(chainName, newClients);

      return newClients;
    } catch (error) {
      throw new Error('Unable to connect to RPC client. ' + error);
    }
  }
}
