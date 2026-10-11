import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import {
  CreateShiftDto,
  MyAttendanceDto,
  MyAttendanceQueryDto,
  ShiftDto,
  ShiftPlanDto,
  ShiftPlanQueryDto,
  TimesheetDayDto,
  TimesheetDto,
  TimesheetQueryDto,
  UpdateAttendanceRecordDto,
  UpdateShiftDto,
  UpdateShiftPlanDto,
  UpdateShiftPlanResultDto,
} from './dto/attendance.dto';
import { AttendanceService } from './attendance.service';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller({ path: 'shifts', version: '1' })
export class ShiftsController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequirePermissions('attendance:read')
  @ApiOkResponse({ type: [ShiftDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.attendance.findShifts(companyId);
  }

  @Post()
  @RequirePermissions('attendance:update')
  @ApiOkResponse({ type: ShiftDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateShiftDto) {
    return this.attendance.createShift(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('attendance:update')
  @ApiOkResponse({ type: ShiftDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.attendance.updateShift(companyId, id, dto);
  }
}

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller({ path: 'shift-plan', version: '1' })
export class ShiftPlanController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequirePermissions('attendance:read')
  @ApiOkResponse({ type: ShiftPlanDto })
  find(@CurrentUser('companyId') companyId: string, @Query() query: ShiftPlanQueryDto) {
    return this.attendance.findPlan(companyId, query);
  }

  @Put()
  @RequirePermissions('attendance:update')
  @ApiOkResponse({ type: UpdateShiftPlanResultDto })
  update(@CurrentUser('companyId') companyId: string, @Body() dto: UpdateShiftPlanDto) {
    return this.attendance.updatePlan(companyId, dto);
  }
}

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** Monthly timesheet (puantaj) of all employees. */
  @Get('timesheet')
  @RequirePermissions('attendance:read')
  @ApiOkResponse({ type: TimesheetDto })
  timesheet(@CurrentUser('companyId') companyId: string, @Query() query: TimesheetQueryDto) {
    return this.attendance.timesheet(companyId, query.month, query.departmentId);
  }

  /** The caller's own month; defaults to the current month. */
  @Get('me')
  @ApiOkResponse({ type: MyAttendanceDto })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyAttendanceQueryDto) {
    return this.attendance.mine(user, query.month);
  }

  @Post('check-in')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MyAttendanceDto })
  checkIn(@CurrentUser() user: AuthUser) {
    return this.attendance.checkIn(user);
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MyAttendanceDto })
  checkOut(@CurrentUser() user: AuthUser) {
    return this.attendance.checkOut(user);
  }

  @Put('records')
  @RequirePermissions('attendance:update')
  @ApiOkResponse({ type: TimesheetDayDto })
  updateRecord(@CurrentUser() user: AuthUser, @Body() dto: UpdateAttendanceRecordDto) {
    return this.attendance.updateRecord(user, dto);
  }
}
