import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { DepartmentsService } from './departments.service';
import { EmployeesService } from './employees.service';
import {
  HolidaysController,
  LeaveBalancesController,
  LeaveRequestsController,
  LeaveTypesController,
} from './leave.controller';
import { LeaveListener } from './leave.listener';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveSettingsService } from './leave-settings.service';
import {
  DepartmentsController,
  EmployeesController,
  PositionsController,
} from './organization.controller';
import { PositionsService } from './positions.service';

/** Human resources: organization structure, personnel records and leave management. */
@Module({
  imports: [WorkflowModule],
  controllers: [
    DepartmentsController,
    PositionsController,
    EmployeesController,
    LeaveTypesController,
    HolidaysController,
    LeaveBalancesController,
    LeaveRequestsController,
  ],
  providers: [
    DepartmentsService,
    PositionsService,
    EmployeesService,
    LeaveSettingsService,
    LeaveRequestsService,
    LeaveListener,
  ],
  exports: [EmployeesService],
})
export class HrModule {}
