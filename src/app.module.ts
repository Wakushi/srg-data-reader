import { Module } from '@nestjs/common';
import { TokenModule } from './token/token.module';
import { ExplorerModule } from './explorer/explorer.module';
import { ChainName } from 'entities/chains';
import { envSchema } from 'config/env.validation';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (config) => envSchema.parse(config),
      isGlobal: true,
    }),
    TokenModule,
    ExplorerModule.forRoot({
      rpcUrls: {
        [ChainName.ETHEREUM]: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        [ChainName.ARBITRUM]: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        [ChainName.BSC]: `https://bnb-mainnet.g.alchemy.com/v2/v2/${process.env.ALCHEMY_API_KEY}`,
      },
      apiKey: process.env.ALCHEMY_API_KEY,
    }),
    SupabaseModule.forRoot({
      privateKey: process.env.SUPABASE_API_KEY,
      url: process.env.SUPABASE_URL,
    }),
  ],
})
export class AppModule {}
