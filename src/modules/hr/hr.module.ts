import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { WorkflowModule } from '../workflow/workflow.module';
import {
  AttendanceController,
  ShiftPlanController,
  ShiftsController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';
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

/** Human resources: organization structure, personnel records, leave, shifts and attendance. */
@Module({
  imports: [WorkflowModule, AssetsModule],
  controllers: [
    DepartmentsController,
    PositionsController,
    EmployeesController,
    LeaveTypesController,
    HolidaysController,
    LeaveBalancesController,
    LeaveRequestsController,
    ShiftsController,
    ShiftPlanController,
    AttendanceController,
  ],
  providers: [
    AttendanceService,
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
