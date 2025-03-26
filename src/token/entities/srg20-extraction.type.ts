import { ChainName } from 'entities/chains';
import { Address } from 'viem';

export type Srg20ExtractionPayload = {
  contract: Address;
  chain: ChainName;
  fromTimestamp?: number;
};
