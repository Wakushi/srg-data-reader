import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { TokenService } from './token.service';
import { Address } from 'viem';
import { ChainName } from 'shared/chains';
import { Collection } from 'src/supabase/entities/collections.type';
import { Srg20ExtractionPayload } from './entities/srg20-extraction.type';
import { ONE_HOUR_IN_SECOND } from 'shared/constants';

@Controller('token')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Get('/:contract')
  async getSrg20History(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20History(contract);
  }

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
    return await this.tokenService.getSrg20VolumeHistory(contract);
  }

  @Post('extract')
  async extractTokenHistory(
    @Body()
    { token, chain }: { token: Address; chain: ChainName },
  ) {
    const isSrg20Contract = await this.tokenService.isSRG20Contract(
      token,
      chain,
    );

    if (!isSrg20Contract) {
      throw new BadRequestException(
        `Address ${token} is not a SRG20 contract implementation`,
      );
    }

    const extractionPayload: Srg20ExtractionPayload = {
      contract: token,
      chain,
    };

    const priceHistory = await this.tokenService.getSrg20PriceHistory(token);

    if (priceHistory && priceHistory.length) {
      priceHistory.sort((a, b) => b[0] - a[0]);
      const latestPriceAt = priceHistory[0][0];
      const extractFrom = latestPriceAt + ONE_HOUR_IN_SECOND;

      if (extractFrom >= Date.now()) return;

      extractionPayload.fromTimestamp = extractFrom;
    }

    await this.tokenService.extractSrg20History(extractionPayload);
  }

  @Post('sync-volume')
  async syncVolumeHistory(
    @Body()
    { token, chain }: { token: Address; chain: ChainName },
  ) {
    await this.tokenService.syncVolumeHistory(token, chain);
  }

  @Get('surge')
  async getSrgHistory() {
    const history = await this.tokenService.getSrgHistory();
    return history;
  }

  @Get('contracts/:chain')
  async getSrgContracts(@Param() { chain }: { chain: ChainName }) {
    const contracts = await this.tokenService.getSrg20Contracts(chain);
    return contracts;
  }
}
