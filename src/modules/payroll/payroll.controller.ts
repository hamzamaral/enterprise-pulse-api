import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  CreatePayrollPeriodDto,
  CreateSalaryRecordDto,
  EmployeeSalaryDto,
  MyPayslipDto,
  PayPayrollPeriodDto,
  PayrollParameterDto,
  PayrollPeriodDetailDto,
  PayrollPeriodDto,
  PayrollPeriodQueryDto,
  PayrollSummaryDto,
  PayslipDetailDto,
  SalaryQueryDto,
  SalaryRecordDto,
  UpdatePayrollParameterDto,
  UpdatePayslipDto,
} from './dto/payroll.dto';
import { PayrollService } from './payroll.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { SalariesService } from './salaries.service';

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller({ path: 'payroll-periods', version: '1' })
export class PayrollPeriodsController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: PaginatedResponseDto(PayrollPeriodDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PayrollPeriodQueryDto) {
    return this.payroll.findAll(companyId, query);
  }

  @Get('summary')
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: PayrollSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.payroll.summary(companyId);
  }

  @Get(':id')
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.findOne(user, id);
  }

  @Post()
  @RequirePermissions('payroll:create')
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePayrollPeriodDto) {
    return this.payroll.create(user, dto);
  }

  @Post(':id/recalculate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll:create')
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  recalculate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.recalculate(user, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll:approve')
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.approve(user, id);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll:approve')
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.reopen(user, id);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll:pay')
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayPayrollPeriodDto,
  ) {
    return this.payroll.pay(user, id, dto);
  }

  @Post(':id/reverse-payment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll:pay')
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  reversePayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.reversePayment(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('payroll:create')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.remove(user, id);
  }
}

/** Own payslips need no permission; the service checks ownership. */
@ApiTags('Payroll')
@ApiBearerAuth()
@Controller({ path: 'payslips', version: '1' })
export class PayslipsController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('mine')
  @ApiOkResponse({ type: [MyPayslipDto] })
  mine(@CurrentUser() user: AuthUser) {
    return this.payroll.mine(user);
  }

  @Get(':id')
  @ApiOkResponse({ type: PayslipDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.payslip(user, id);
  }

  @Patch(':id')
  @RequirePermissions('payroll:create')
  @ApiOkResponse({ type: PayslipDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayslipDto,
  ) {
    return this.payroll.updatePayslip(user, id, dto);
  }
}

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller({ path: 'salaries', version: '1' })
export class SalariesController {
  constructor(private readonly salaries: SalariesService) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: PaginatedResponseDto(EmployeeSalaryDto) })
  current(@CurrentUser('companyId') companyId: string, @Query() query: SalaryQueryDto) {
    return this.salaries.current(companyId, query);
  }

  @Get('employees/:employeeId')
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: [SalaryRecordDto] })
  history(
    @CurrentUser('companyId') companyId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.salaries.history(companyId, employeeId);
  }

  @Post()
  @RequirePermissions('payroll:update')
  @ApiOkResponse({ type: [SalaryRecordDto] })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalaryRecordDto) {
    return this.salaries.create(user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('payroll:update')
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.salaries.remove(companyId, id);
  }
}

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller({ path: 'payroll-parameters', version: '1' })
export class PayrollParametersController {
  constructor(private readonly settings: PayrollSettingsService) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: [PayrollParameterDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.settings.findAll(companyId);
  }

  @Get(':year')
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: PayrollParameterDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('year', ParseIntPipe) year: number) {
    return this.settings.findOne(companyId, year);
  }

  @Put(':year')
  @RequirePermissions('payroll:update')
  @ApiOkResponse({ type: PayrollParameterDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: UpdatePayrollParameterDto,
  ) {
    return this.settings.update(companyId, year, dto);
  }
}
