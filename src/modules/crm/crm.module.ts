import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { PartnersModule } from '../partners/partners.module';
import { CrmActivitiesService } from './crm-activities.service';
import {
  CrmActivitiesController,
  CrmController,
  LeadsController,
  OpportunitiesController,
} from './crm.controller';
import { CrmSummaryService } from './crm-summary.service';
import { CrmSupportService } from './crm-support.service';
import { LeadsService } from './leads.service';
import { OpportunitiesService } from './opportunities.service';

/** CRM: leads → customers, the opportunity pipeline (linked to sales quotes) and activities. */
@Module({
  imports: [PartnersModule, FinanceModule],
  controllers: [CrmController, LeadsController, OpportunitiesController, CrmActivitiesController],
  providers: [
    CrmSupportService,
    LeadsService,
    OpportunitiesService,
    CrmActivitiesService,
    CrmSummaryService,
  ],
  exports: [OpportunitiesService],
})
export class CrmModule {}
