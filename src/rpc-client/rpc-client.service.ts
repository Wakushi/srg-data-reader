import { Inject, Injectable } from '@nestjs/common';
import { ChainName } from 'shared/chains';
import { ChainRpcUrls } from 'shared/rpc-url-config.type';
import { getChainByName } from 'shared/utils';
import { createPublicClient, http, PublicClient } from 'viem';

export type RpcClient = {
  name: string;
  index: number;
  batchSize: number;
  client: PublicClient;
};

const REQUIRED_SUCCESS_RATE = 5;
const REQUIRED_FAIL_RATE = -5;

@Injectable()
export class RpcClientService {
  private clientsByChain: Map<ChainName, RpcClient[]> = new Map();

  private activeClientByChain: Map<ChainName, RpcClient> = new Map();

  private clientBatchSizesRates: Map<string, Map<number, number>> = new Map();

  constructor(
    @Inject('RPC_CLIENT_CONFIG')
    private readonly config: { rpcUrls: ChainRpcUrls; apiKey: string },
  ) {}

  public getClient(chain: ChainName): RpcClient {
    const rpcClients = this.getClients(chain);

    if (!rpcClients || !rpcClients.length) {
      throw new Error('No clients found for chain ' + chain);
    }

    const activeClient = this.activeClientByChain.get(chain);

    if (!activeClient) {
      const rpcClient = rpcClients[0];

      this.activeClientByChain.set(chain, rpcClient);

      return rpcClient;
    }

    const nextClientIndex = (activeClient.index + 1) % rpcClients.length;
    const rpcClient = rpcClients.find((c) => c.index === nextClientIndex);

    if (!rpcClient) {
      throw new Error('No rpc client found for index ' + nextClientIndex);
    }

    this.activeClientByChain.set(chain, rpcClient);
    return rpcClient;
  }

  private getClients(chainName: ChainName): RpcClient[] {
    const clients = this.clientsByChain.get(chainName);

    if (clients) return clients;

    try {
      const rpcUrls = this.config.rpcUrls[chainName];

      if (!rpcUrls || !rpcUrls.length) {
        throw new Error('Missing RPCs for chain ' + chainName);
      }

      const chain = getChainByName(chainName);

      const newClients = rpcUrls.map(({ name, url, batchSize }, index) => ({
        name,
        index,
        batchSize,
        client: createPublicClient({
          chain,
          transport: http(url, {
            batch: { batchSize, wait: 16 },
            name,
            retryCount: 1,
            timeout: 5000,
          }),
        }),
      }));

      this.clientsByChain.set(chainName, newClients);

      return newClients;
    } catch (error) {
      throw new Error('Unable to connect to RPC client. ' + error);
    }
  }

  public recordSuccess(client: RpcClient): void {
    const batchSizesRates = this.getClientBatchSizeRates(client);

    if (!batchSizesRates.has(client.batchSize)) {
      batchSizesRates.set(client.batchSize, 1);
    } else {
      batchSizesRates.set(
        client.batchSize,
        batchSizesRates.get(client.batchSize)! + 1,
      );
    }

    const batchSizeResult = batchSizesRates.get(client.batchSize)!;

    if (batchSizeResult >= REQUIRED_SUCCESS_RATE) {
      batchSizesRates.set(client.batchSize, 0);
      client.batchSize++;
    }
  }

  public recordFailure(client: RpcClient): void {
    const batchSizesRates = this.getClientBatchSizeRates(client);

    if (!batchSizesRates.has(client.batchSize)) {
      batchSizesRates.set(client.batchSize, 1);
    } else {
      batchSizesRates.set(
        client.batchSize,
        batchSizesRates.get(client.batchSize)! - 1,
      );
    }

    const batchSizeResult = batchSizesRates.get(client.batchSize)!;

    if (batchSizeResult <= REQUIRED_FAIL_RATE && client.batchSize > 1) {
      batchSizesRates.set(client.batchSize, 0);
      client.batchSize -= 2;

      if (client.batchSize < 1) {
        client.batchSize = 1;
      }
    }
  }

  private getClientBatchSizeRates(client: RpcClient): Map<number, number> {
    if (!this.clientBatchSizesRates.has(client.name)) {
      this.clientBatchSizesRates.set(client.name, new Map());
    }

    const batchSizesRates = this.clientBatchSizesRates.get(client.name)!;
    return batchSizesRates;
  }
}
