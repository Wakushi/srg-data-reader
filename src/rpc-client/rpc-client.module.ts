import { DynamicModule, Module } from '@nestjs/common';
import { RpcClientService } from './rpc-client.service';
import { ChainRpcUrls } from 'shared/rpc-url-config.type';

@Module({})
export class RpcClientModule {
  static forRoot(config: { rpcUrls: ChainRpcUrls }): DynamicModule {
    return {
      module: RpcClientModule,
      providers: [
        {
          provide: 'RPC_CLIENT_CONFIG',
          useValue: config,
        },
        RpcClientService,
      ],
      exports: [RpcClientService],
      global: true,
    };
  }
}
