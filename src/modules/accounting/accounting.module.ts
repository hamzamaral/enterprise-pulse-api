import { Module } from '@nestjs/common';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingReportsService } from './accounting-reports.service';
import {
  AccountingController,
  JournalEntriesController,
  LedgerAccountsController,
} from './accounting.controller';
import { AccountingProcessor } from './accounting.processor';
import { JournalService } from './journal.service';
import { LedgerAccountsService } from './ledger-accounts.service';

/** Muhasebe: chart of accounts, journal, automatic posting and financial statements. */
@Module({
  controllers: [AccountingController, LedgerAccountsController, JournalEntriesController],
  providers: [
    LedgerAccountsService,
    JournalService,
    AccountingPostingService,
    AccountingReportsService,
    AccountingProcessor,
  ],
})
export class AccountingModule {}
