import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

@Module({
  controllers: [CompaniesController, BranchesController],
  providers: [CompaniesService, BranchesService],
  exports: [CompaniesService, BranchesService],
})
export class OrganizationsModule {}
