import { Inject, Injectable } from '@nestjs/common';
import { ChainName } from 'entities/chains';
import { RpcUrlConfig } from 'entities/rpc-url-config.type';
import {
  Abi,
  AbiEvent,
  Address,
  Block,
  BlockTag,
  createPublicClient,
  GetBalanceParameters,
  http,
  Log,
  PublicClient,
  ReadContractParameters,
} from 'viem';
import { mainnet } from 'viem/chains';

@Injectable()
export class ExplorerService {
  constructor(
    @Inject('EXPLORER_CONFIG')
    private readonly config: { rpcUrls: RpcUrlConfig; apiKey: string },
  ) {}

  private _clients: Map<ChainName, PublicClient> = new Map();

  public async getBalance({
    chain,
    contract,
    blockNumber,
  }: {
    chain: ChainName;
    contract: Address;
    blockNumber?: bigint | null;
  }): Promise<bigint> {
    try {
      const client = this.getClient(chain);

      const balanceParams: GetBalanceParameters = {
        address: contract,
        ...(blockNumber ? { blockNumber } : {}),
      };

      const balance = await client.getBalance(balanceParams);

      return balance;
    } catch (error) {
      console.error('Error getting balance ' + error);
      return 0n;
    }
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
  }): Promise<Log[] | null> {
    try {
      const client = this.getClient(chain);

      const logs: Log[] = await client.getLogs({
        address: contract,
        event,
        fromBlock,
      });

      logs.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));

      return logs;
    } catch (error) {
      console.error('Error getting logs ' + error);
      return null;
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

  public async getBlockNumberByTimestamp(
    chain: ChainName,
    timestamp: number,
  ): Promise<any> {
    const alchemyChain: Record<ChainName, string> = {
      [ChainName.ETHEREUM]: 'eth-mainnet',
      [ChainName.ARBITRUM]: 'arb-mainnet',
      [ChainName.BSC]: 'bnb-mainnet',
    };

    try {
      const response = await fetch(
        `https://api.g.alchemy.com/data/v1/${this.config.apiKey}/utility/blocks/by-timestamp?networks=${alchemyChain[chain]}&timestamp=${timestamp}&direction=AFTER`,
      );

      const { data } = await response.json();

      return data[0].block.number;
    } catch (error) {
      console.error('Error fetching block number by timestamp :' + error);
    }
  }

  public async readContract({
    chain,
    contract,
    abi,
    functionName,
    blockNumber,
    args,
  }: {
    chain: ChainName;
    contract: Address;
    abi: Abi;
    functionName: string;
    blockNumber?: bigint;
    args?: any;
  }): Promise<any> {
    try {
      const client = this.getClient(chain);

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

      const data = await client.readContract(payload);

      return data;
    } catch (error) {
      console.log('Error fetching block ' + error);
      return null;
    }
  }

  private getClient(chain: ChainName): PublicClient {
    const client = this._clients.get(chain);

    if (client) return client;

    try {
      const newClient = createPublicClient({
        chain: mainnet,
        transport: http(this.config.rpcUrls[chain]),
      });

      this._clients.set(chain, newClient);

      return newClient;
    } catch (error) {
      throw new Error('Unable to connect to RPC client. ' + error);
    }
  }
}
