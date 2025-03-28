import { Module } from '@nestjs/common';
import { TokenModule } from './token/token.module';
import { ExplorerModule } from './explorer/explorer.module';
import { ChainName } from 'shared/chains';
import { envSchema } from 'config/env.validation';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';
import { RpcClientModule } from './rpc-client/rpc-client.module';
import { ALCHEMY_BATCH_SIZE, QUICK_NODE_BATCH_SIZE } from 'shared/constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (config) => envSchema.parse(config),
      isGlobal: true,
    }),
    TokenModule,
    RpcClientModule.forRoot({
      rpcUrls: {
        [ChainName.ETHEREUM]: [
          {
            name: 'alchemy-eth',
            url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
            batchSize: ALCHEMY_BATCH_SIZE,
          },
          {
            name: 'quick-node-eth',
            url: `https://patient-fragrant-season.quiknode.pro/${process.env.QUICKNODE_API_KEY}`,
            batchSize: QUICK_NODE_BATCH_SIZE,
          },
        ],
        [ChainName.ARBITRUM]: [
          {
            name: 'alchemy-arb',
            url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
            batchSize: ALCHEMY_BATCH_SIZE,
          },
          {
            name: 'quick-node-arb',
            url: `https://patient-fragrant-season.quiknode.pro/${process.env.QUICKNODE_API_KEY}`,
            batchSize: QUICK_NODE_BATCH_SIZE,
          },
        ],
        [ChainName.BSC]: [
          {
            name: 'alchemy-bsc',
            url: `https://bnb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
            batchSize: ALCHEMY_BATCH_SIZE,
          },
          {
            name: 'quick-node-bsc',
            url: `https://patient-fragrant-season.bsc.quiknode.pro/${process.env.QUICKNODE_API_KEY}`,
            batchSize: QUICK_NODE_BATCH_SIZE,
          },
        ],
      },
    }),
    ExplorerModule.forRoot({
      apiKey: process.env.ALCHEMY_API_KEY,
    }),
    SupabaseModule.forRoot({
      privateKey: process.env.SUPABASE_API_KEY,
      url: process.env.SUPABASE_URL,
    }),
  ],
})
export class AppModule {}
