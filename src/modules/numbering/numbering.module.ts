import { Global, Module } from '@nestjs/common';
import { NumberingController } from './numbering.controller';
import { NumberingService } from './numbering.service';

@Global()
@Module({
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
