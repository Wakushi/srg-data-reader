import { DynamicModule, Module } from '@nestjs/common';
import { RpcUrlConfig } from 'entities/rpc-url-config.type';
import { ExplorerService } from './explorer.service';

@Module({})
export class ExplorerModule {
  static forRoot(config: {
    rpcUrls: RpcUrlConfig;
    apiKey?: string;
  }): DynamicModule {
    return {
      module: ExplorerModule,
      providers: [
        {
          provide: 'EXPLORER_CONFIG',
          useValue: config,
        },
        ExplorerService,
      ],
      exports: [ExplorerService],
      global: true,
    };
  }
}
