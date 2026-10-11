import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AccrueBalancesDto,
  AccrueResultDto,
  CancelLeaveRequestDto,
  CreateHolidayDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  HolidayDto,
  HolidayQueryDto,
  LeaveBalanceDto,
  LeaveBalanceQueryDto,
  LeaveRequestDto,
  LeaveRequestQueryDto,
  LeaveTypeDto,
  UpdateLeaveBalanceDto,
  UpdateLeaveTypeDto,
  WorkingDaysDto,
  WorkingDaysQueryDto,
} from './dto/leave.dto';
import { hasPermission } from './hr-access';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveSettingsService } from './leave-settings.service';

@ApiTags('Leave')
@ApiBearerAuth()
@Controller({ path: 'leave-types', version: '1' })
export class LeaveTypesController {
  constructor(private readonly settings: LeaveSettingsService) {}

  @Get()
  @ApiOkResponse({ type: [LeaveTypeDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.settings.findTypes(companyId);
  }

  @Post()
  @RequirePermissions('leave:update')
  @ApiOkResponse({ type: LeaveTypeDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateLeaveTypeDto) {
    return this.settings.createType(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('leave:update')
  @ApiOkResponse({ type: LeaveTypeDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.settings.updateType(companyId, id, dto);
  }
}

@ApiTags('Leave')
@ApiBearerAuth()
@Controller({ path: 'holidays', version: '1' })
export class HolidaysController {
  constructor(private readonly settings: LeaveSettingsService) {}

  @Get()
  @ApiOkResponse({ type: [HolidayDto] })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: HolidayQueryDto) {
    return this.settings.findHolidays(companyId, query.year);
  }

  @Post()
  @RequirePermissions('leave:update')
  @ApiOkResponse({ type: HolidayDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateHolidayDto) {
    return this.settings.createHoliday(companyId, dto);
  }

  @Delete(':id')
  @RequirePermissions('leave:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.removeHoliday(companyId, id);
  }
}

@ApiTags('Leave')
@ApiBearerAuth()
@Controller({ path: 'leave-balances', version: '1' })
export class LeaveBalancesController {
  constructor(
    private readonly settings: LeaveSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Without `leave:read` only the caller's own balances are returned. */
  @Get()
  @ApiOkResponse({ type: [LeaveBalanceDto] })
  async findAll(@CurrentUser() user: AuthUser, @Query() query: LeaveBalanceQueryDto) {
    const year = query.year ?? new Date().getFullYear();
    if (hasPermission(user, 'leave:read')) {
      return this.settings.findBalances(user.companyId, { employeeId: query.employeeId, year });
    }
    const own = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!own) throw new NotFoundException('No employee record is linked to your account');
    if (query.employeeId && query.employeeId !== own.id) {
      throw new ForbiddenException('Missing permission: leave:read');
    }
    return this.settings.findBalances(user.companyId, { employeeId: own.id, year });
  }

  @Post('accrue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('leave:update')
  @ApiOkResponse({ type: AccrueResultDto })
  accrue(@CurrentUser('companyId') companyId: string, @Body() dto: AccrueBalancesDto) {
    return this.settings.accrue(companyId, dto.year);
  }

  @Patch(':id')
  @RequirePermissions('leave:update')
  @ApiOkResponse({ type: LeaveBalanceDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveBalanceDto,
  ) {
    return this.settings.updateBalance(companyId, id, dto);
  }
}

@ApiTags('Leave')
@ApiBearerAuth()
@Controller({ path: 'leave-requests', version: '1' })
export class LeaveRequestsController {
  constructor(private readonly requests: LeaveRequestsService) {}

  /** Without `leave:read` (or with `mine=true`) only the caller's own requests are returned. */
  @Get()
  @ApiOkResponse({ type: PaginatedResponseDto(LeaveRequestDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: LeaveRequestQueryDto) {
    return this.requests.findAll(user, query);
  }

  /** Working days in the range, excluding weekends and company holidays. */
  @Get('working-days')
  @ApiOkResponse({ type: WorkingDaysDto })
  workingDays(@CurrentUser('companyId') companyId: string, @Query() query: WorkingDaysQueryDto) {
    return this.requests.workingDays(companyId, query.startDate, query.endDate);
  }

  @Get(':id')
  @ApiOkResponse({ type: LeaveRequestDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.findOne(user, id);
  }

  @Post()
  @ApiOkResponse({ type: LeaveRequestDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeaveRequestDto) {
    return this.requests.create(user, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LeaveRequestDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelLeaveRequestDto,
  ) {
    return this.requests.cancel(user, id, dto);
  }
}
