import { Module } from '@nestjs/common';
import { PartnersModule } from '../partners/partners.module';
import { ChequesService } from './cheques.service';
import {
  ChequesController,
  FinanceReportsController,
  PaymentsController,
  TreasuryAccountsController,
} from './finance.controller';
import { FinanceReportsService } from './finance-reports.service';
import { PaymentsService } from './payments.service';
import { TreasuryService } from './treasury.service';

/** Finance: cash and bank accounts, collections / payments with invoice allocation, cheques. */
@Module({
  imports: [PartnersModule],
  controllers: [
    TreasuryAccountsController,
    PaymentsController,
    ChequesController,
    FinanceReportsController,
  ],
  providers: [TreasuryService, PaymentsService, ChequesService, FinanceReportsService],
})
export class FinanceModule {}
