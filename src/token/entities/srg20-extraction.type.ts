import { ChainName } from 'shared/chains';
import { Address } from 'viem';

export type SrgExtractionPayload = {
  chain: ChainName;
  fromTimestamp?: number;
  fromBlockNumber?: bigint;
};

export type Srg20ExtractionPayload = SrgExtractionPayload & {
  contract: Address;
};
