import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TokenService } from './token.service';
import { Address } from 'viem';
import { ChainName } from 'entities/chains';
import { Collection } from 'src/supabase/entities/collections.type';

@Controller('token')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Get('price/:contract')
  async getTokenPriceHistory(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20PriceHistory(contract);
  }

  @Get('liquidity/:contract')
  async getTokenLiquidityHistory(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20LiquidityHistory(contract);
  }

  @Get('volume/:contract')
  async getTokenVolumeHistory(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20VolumeHistory({
      chain: ChainName.ETHEREUM,
      contract,
    });
  }

  @Post('history')
  async extractTokenHistory(
    @Body() { token, chain }: { token: Address; chain: ChainName },
  ) {
    await this.tokenService.extractSrg20History({
      contract: token,
      chain,
      save: true,
    });
  }

  @Get('surge')
  async getSrgHistory() {
    const history = await this.tokenService.getSrgHistory(
      Collection.SURGE_HISTORICAL_DATA,
    );
    return history;
  }
}
