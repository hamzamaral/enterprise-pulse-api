import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { HrModule } from '../hr/hr.module';
import {
  PayrollParametersController,
  PayrollPeriodsController,
  PayslipsController,
  SalariesController,
} from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { SalariesService } from './salaries.service';

/** Payroll (bordro): salaries, yearly parameters, monthly periods, payslips and payment. */
@Module({
  imports: [HrModule, FinanceModule],
  controllers: [
    PayrollPeriodsController,
    PayslipsController,
    SalariesController,
    PayrollParametersController,
  ],
  providers: [PayrollService, PayrollSettingsService, SalariesService],
  exports: [SalariesService],
})
export class PayrollModule {}
