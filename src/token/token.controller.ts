import { Controller, Get, Param } from '@nestjs/common';
import { TokenService } from './token.service';
import { Address } from 'viem';

@Controller('token')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Get('historical/:token')
  async getHistoricalData(@Param() { token }: { token: Address }) {
    return await this.tokenService.getHistoricalData(token);
  }
}
