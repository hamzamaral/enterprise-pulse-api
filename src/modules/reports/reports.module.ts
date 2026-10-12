import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CashFlowService } from './cash-flow.service';
import { ReportsController } from './reports.controller';
import { TradeReportsService } from './trade-reports.service';

/** Read-only analysis across modules: sales, purchases and cash flow. */
@Module({
  imports: [FinanceModule],
  controllers: [ReportsController],
  providers: [TradeReportsService, CashFlowService],
})
export class ReportsModule {}
