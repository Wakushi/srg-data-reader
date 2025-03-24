import { AbiEvent } from 'viem';

export const WETH_USDC_POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';
export const SRG_ETH = '0xcD682EF09d07668d49A8103ddD65Ff54AebFbfDe';

export const SRG_DECIMALS = 9;
export const ETH_DECIMALS = 18;

export const SRG_BOUGHT_EVENT: AbiEvent = {
  type: 'event',
  name: 'Bought',
  inputs: [
    { type: 'address', indexed: true, name: 'from' },
    { type: 'address', indexed: true, name: 'to' },
    { type: 'uint256', indexed: false, name: 'tokens' },
    { type: 'uint256', indexed: false, name: 'beans' },
    { type: 'uint256', indexed: false, name: 'dollarBuy' },
  ],
};

export const SRG_SOLD_EVENT: AbiEvent = {
  type: 'event',
  name: 'Sold',
  inputs: [
    { type: 'address', indexed: true, name: 'from' },
    { type: 'address', indexed: true, name: 'to' },
    { type: 'uint256', indexed: false, name: 'tokens' },
    { type: 'uint256', indexed: false, name: 'beans' },
    { type: 'uint256', indexed: false, name: 'dollarSell' },
  ],
};

export const TRANSFER_EVENT: AbiEvent = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { type: 'address', indexed: true, name: 'from' },
    { type: 'address', indexed: true, name: 'to' },
    { type: 'uint256', indexed: false, name: 'value' },
  ],
};

export const UNISWAP_POOL_ABI = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const IERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
