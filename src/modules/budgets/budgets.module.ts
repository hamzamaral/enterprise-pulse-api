import { Module } from '@nestjs/common';
import { BudgetActualsService } from './budget-actuals.service';
import { BudgetEntriesService } from './budget-entries.service';
import { BudgetItemsService } from './budget-items.service';
import {
  BudgetEntriesController,
  BudgetItemsController,
  BudgetsController,
} from './budgets.controller';
import { BudgetsProcessor } from './budgets.processor';
import { BudgetsService } from './budgets.service';

/** Budgets (bütçe): yearly company and department plans compared with the actuals. */
@Module({
  controllers: [BudgetsController, BudgetItemsController, BudgetEntriesController],
  providers: [
    BudgetsService,
    BudgetItemsService,
    BudgetEntriesService,
    BudgetActualsService,
    BudgetsProcessor,
  ],
})
export class BudgetsModule {}
