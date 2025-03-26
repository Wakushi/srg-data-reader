import { ChainName } from './chains';

export type RpcUrlConfig = {
  [ChainName.ETHEREUM]: string[];
  [ChainName.ARBITRUM]: string[];
  [ChainName.BSC]: string[];
};
