import { ChainName } from 'shared/chains';
import { AbiEvent, Address, keccak256, toBytes } from 'viem';

export const ONE_HOUR_IN_SECOND = 60 * 60;

export const ALCHEMY_BATCH_SIZE = 15;
export const QUICK_NODE_BATCH_SIZE = 10;

export const ALCHEMY_RATE_LIMIT_ERROR_CODE = 429;
export const QUICK_NODE_RATE_LIMIT_ERROR_CODE = -32007;

export const WETH_USDC_POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';
export const WETH_USDC_ARB_POOL = '0xC6962004f452bE9203591991D15f6b388e09E8D0';
export const WBNB_USDT_POOL = '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE';

export const SRG_CONTRACTS: Record<ChainName, Address> = {
  [ChainName.ETHEREUM]: '0xcD682EF09d07668d49A8103ddD65Ff54AebFbfDe',
  [ChainName.ARBITRUM]: '0x31ad8255cb8e428e8b0f6ab6a6f44804642720af',
  [ChainName.BSC]: '0x9f19c8e321bD14345b797d43E01f0eED030F5Bff',
};

export const CHAIN_BLOCK_TIMES: Record<ChainName, number> = {
  [ChainName.ETHEREUM]: 12,
  [ChainName.BSC]: 3,
  [ChainName.ARBITRUM]: 1,
};

export const SRG20_BUY_SIGNATURE = keccak256(
  toBytes('_buy(uint256,uint256,uint256)'),
);
export const SRG20_SELL_SIGNATURE = keccak256(
  toBytes('_sell(uint256,uint256,uint256)'),
);

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

export const SRG_ABI = [
  {
    inputs: [],
    name: 'liquidity',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getLiquidity',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [
      {
        internalType: 'string',
        name: '',
        type: 'string',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
] as const;
