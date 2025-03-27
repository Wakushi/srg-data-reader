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
import {
  Srg20ExtractionPayload,
  SrgExtractionPayload,
} from './entities/srg20-extraction.type';
import { ONE_HOUR_IN_SECOND } from 'shared/constants';

@Controller('token')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Get('/:contract')
  async getSrg20History(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20History(contract);
  }

  @Get('price/:contract')
  async getSrg20PriceHistory(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20PriceHistory(contract);
  }

  @Get('liquidity/:contract')
  async getSrg20LiquidityHistory(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20LiquidityHistory(contract);
  }

  @Get('volume/:contract')
  async getSrg20VolumeHistory(@Param() { contract }: { contract: Address }) {
    return await this.tokenService.getSrg20VolumeHistory(contract);
  }

  @Post('extract-srg20')
  async extractSrg20History(
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

  @Post('extract-srg')
  async extractSrgHistory(
    @Body()
    {
      chain,
      fromTimestamp,
      fromBlockNumber,
    }: {
      chain: ChainName;
      fromTimestamp: number;
      fromBlockNumber: bigint;
    },
  ) {
    const extractionPayload: SrgExtractionPayload = {
      chain,
    };

    if (fromBlockNumber) {
      extractionPayload.fromBlockNumber = fromBlockNumber;
      await this.tokenService.extractSrgHistory(extractionPayload);
      return;
    }

    if (fromTimestamp) {
      extractionPayload.fromTimestamp = fromTimestamp;
      await this.tokenService.extractSrgHistory(extractionPayload);
      return;
    }

    const priceHistory = await this.tokenService.getSrgHistory(chain);

    if (priceHistory && priceHistory.length) {
      priceHistory.sort((a, b) => b.timestamp - a.timestamp);

      const latestPriceAt = priceHistory[0].timestamp;
      const extractFrom = latestPriceAt + ONE_HOUR_IN_SECOND;

      if (extractFrom >= Date.now()) return;

      extractionPayload.fromTimestamp = extractFrom;
    }

    await this.tokenService.extractSrgHistory(extractionPayload);
  }

  @Post('sync-volume')
  async syncVolumeHistory(
    @Body()
    { token, chain }: { token: Address; chain: ChainName },
  ) {
    await this.tokenService.syncVolumeHistory(token, chain);
  }

  @Get('srg/:chain')
  async getSrgHistory(@Param() { chain }: { chain: ChainName }) {
    const history = await this.tokenService.getSrgHistory(chain);
    return history;
  }

  @Get('contracts/:chain')
  async getSrgContracts(@Param() { chain }: { chain: ChainName }) {
    const contracts = await this.tokenService.getSrg20Contracts(chain);
    return contracts;
  }
}
