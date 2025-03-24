import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';
import { ExplorerModule } from 'src/explorer/explorer.module';

@Module({
  imports: [ExplorerModule],
  controllers: [TokenController],
  providers: [TokenService],
})
export class TokenModule {}
