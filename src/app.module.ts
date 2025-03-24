import { Module } from '@nestjs/common';
import { TokenModule } from './token/token.module';
import { ExplorerModule } from './explorer/explorer.module';
import { ChainName } from 'entities/chains';
import { envSchema } from 'config/env.validation';
import { ConfigModule } from '@nestjs/config';

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
  ],
})
export class AppModule {}
