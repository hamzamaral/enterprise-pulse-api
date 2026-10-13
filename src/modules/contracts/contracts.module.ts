import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ContractSummaryService } from './contract-summary.service';
import { ContractTypesService } from './contract-types.service';
import { ContractTypesController, ContractsController } from './contracts.controller';
import { ContractsProcessor } from './contracts.processor';
import { ContractsService } from './contracts.service';

/** Contracts (sözleşmeler): partner and employee contracts, renewals and expiry reminders. */
@Module({
  imports: [FilesModule],
  controllers: [ContractsController, ContractTypesController],
  providers: [ContractsService, ContractTypesService, ContractSummaryService, ContractsProcessor],
})
export class ContractsModule {}
