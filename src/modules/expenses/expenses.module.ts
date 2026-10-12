import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { FinanceModule } from '../finance/finance.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseReportsService } from './expense-reports.service';
import { ExpenseCategoriesController, ExpenseReportsController } from './expenses.controller';
import { ExpensesListener } from './expenses.listener';

/** Expense reports and travel allowances (masraf ve harcırah): approval and reimbursement. */
@Module({
  imports: [WorkflowModule, FinanceModule, FilesModule],
  controllers: [ExpenseCategoriesController, ExpenseReportsController],
  providers: [ExpenseCategoriesService, ExpenseReportsService, ExpensesListener],
  exports: [ExpenseReportsService],
})
export class ExpensesModule {}
