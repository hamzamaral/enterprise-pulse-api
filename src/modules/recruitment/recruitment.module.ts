import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { HrModule } from '../hr/hr.module';
import { PayrollModule } from '../payroll/payroll.module';
import { CandidatesService } from './candidates.service';
import { InterviewsService } from './interviews.service';
import { JobApplicationsService } from './job-applications.service';
import { JobPostingsService } from './job-postings.service';
import {
  CandidatesController,
  InterviewsController,
  JobApplicationsController,
  JobOffersController,
  JobPostingsController,
} from './recruitment.controller';

/** Recruitment (işe alım): postings, candidates, the hiring pipeline, interviews and offers. */
@Module({
  imports: [HrModule, PayrollModule, FilesModule],
  controllers: [
    JobPostingsController,
    CandidatesController,
    JobApplicationsController,
    InterviewsController,
    JobOffersController,
  ],
  providers: [JobPostingsService, CandidatesService, JobApplicationsService, InterviewsService],
})
export class RecruitmentModule {}
