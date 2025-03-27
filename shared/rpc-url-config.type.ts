import { ChainName } from './chains';

export type ChainRpcUrls = {
  [ChainName.ETHEREUM]: RpcConfig[];
  [ChainName.ARBITRUM]: RpcConfig[];
  [ChainName.BSC]: RpcConfig[];
};

export type RpcConfig = {
  name: string;
  url: string;
  batchSize: number;
};
