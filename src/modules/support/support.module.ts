import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import {
  TicketCategoriesController,
  TicketSlaPoliciesController,
  TicketsController,
} from './support.controller';
import { SupportSummaryService } from './support-summary.service';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketsService } from './tickets.service';

/** Support (destek): tickets, categories, SLA targets, assignment and the conversation. */
@Module({
  imports: [FilesModule],
  controllers: [TicketsController, TicketCategoriesController, TicketSlaPoliciesController],
  providers: [TicketsService, TicketCategoriesService, SupportSummaryService],
})
export class SupportModule {}
