import { ChainName } from 'entities/chains';
import { Address } from 'viem';

export type HistoricPrice = {
  id?: number;
  timestamp: number;
  real_native_balance: number;
  internal_native_balance: number;
  native_price_usd: number;
  srg_balance: string;
  internal_srg_price_usd: number;
  real_price_usd: number;
};

export type Srg20HourlyPrice = {
  id?: number;
  timestamp: number;
  token_address: Address;
  chain: ChainName;
  srg_balance: number;
  token_balance: number;
  internal_price_usd: number;
  real_price_usd: number;
  internal_liquidity_usd: number;
  real_liquidity_usd: number;
};

export interface LogEvent {
  eventName: string;
  args: {
    from: string;
    to: string;
    value: bigint;
    tokens?: bigint;
  };
  address: string;
  blockHash: string;
  blockNumber: bigint;
  data: string;
  logIndex: number;
  removed: boolean;
  topics: string[];
  transactionHash: string;
  transactionIndex?: number;
}
