import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { CancelDocumentDto } from '../partners/dto/trade.dto';
import { ChequesService } from './cheques.service';
import {
  AgingQueryDto,
  AgingReportDto,
  CashPositionDto,
  ChequeActionDto,
  ChequeDetailDto,
  ChequeDto,
  ChequeQueryDto,
  CreatePaymentDto,
  CreateTreasuryAccountDto,
  FinanceSummaryDto,
  OpenInvoiceDto,
  OpenInvoicesQueryDto,
  PaymentDetailDto,
  PaymentDto,
  PaymentQueryDto,
  TreasuryAccountDto,
  TreasuryAccountQueryDto,
  TreasuryStatementDto,
  TreasuryStatementQueryDto,
  UpdateTreasuryAccountDto,
} from './dto/finance.dto';
import { FinanceReportsService } from './finance-reports.service';
import { PaymentsService } from './payments.service';
import { TreasuryService } from './treasury.service';

@ApiTags('Finance')
@ApiBearerAuth()
@Controller({ path: 'treasury-accounts', version: '1' })
export class TreasuryAccountsController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: [TreasuryAccountDto] })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: TreasuryAccountQueryDto) {
    return this.treasury.findAll(companyId, query);
  }

  @Get('position')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: CashPositionDto })
  position(@CurrentUser('companyId') companyId: string) {
    return this.treasury.position(companyId);
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: TreasuryAccountDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.treasury.findOne(companyId, id);
  }

  @Get(':id/statement')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: TreasuryStatementDto })
  statement(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TreasuryStatementQueryDto,
  ) {
    return this.treasury.statement(companyId, id, query);
  }

  @Post()
  @RequirePermissions('finance:update')
  @ApiOkResponse({ type: TreasuryAccountDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTreasuryAccountDto) {
    return this.treasury.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('finance:update')
  @ApiOkResponse({ type: TreasuryAccountDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTreasuryAccountDto,
  ) {
    return this.treasury.update(companyId, id, dto);
  }
}

@ApiTags('Finance')
@ApiBearerAuth()
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: PaginatedResponseDto(PaymentDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PaymentQueryDto) {
    return this.payments.findAll(companyId, query);
  }

  @Get('open-invoices')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: [OpenInvoiceDto] })
  openInvoices(@CurrentUser('companyId') companyId: string, @Query() query: OpenInvoicesQueryDto) {
    return this.payments.openInvoices(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: PaymentDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('finance:create')
  @ApiOkResponse({ type: PaymentDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.payments.create(user, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('finance:approve')
  @ApiOkResponse({ type: PaymentDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.payments.cancel(user, id, dto);
  }
}

@ApiTags('Finance')
@ApiBearerAuth()
@Controller({ path: 'cheques', version: '1' })
export class ChequesController {
  constructor(private readonly cheques: ChequesService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: PaginatedResponseDto(ChequeDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: ChequeQueryDto) {
    return this.cheques.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: ChequeDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.cheques.findOne(companyId, id);
  }

  @Post(':id/deposit')
  @RequirePermissions('finance:create')
  @ApiOkResponse({ type: ChequeDetailDto })
  deposit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChequeActionDto,
  ) {
    return this.cheques.deposit(user, id, dto);
  }

  @Post(':id/collect')
  @RequirePermissions('finance:create')
  @ApiOkResponse({ type: ChequeDetailDto })
  collect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChequeActionDto,
  ) {
    return this.cheques.collect(user, id, dto);
  }

  @Post(':id/pay')
  @RequirePermissions('finance:create')
  @ApiOkResponse({ type: ChequeDetailDto })
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChequeActionDto,
  ) {
    return this.cheques.pay(user, id, dto);
  }

  @Post(':id/bounce')
  @RequirePermissions('finance:approve')
  @ApiOkResponse({ type: ChequeDetailDto })
  bounce(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChequeActionDto,
  ) {
    return this.cheques.bounce(user, id, dto);
  }
}

@ApiTags('Finance')
@ApiBearerAuth()
@Controller({ path: 'finance-reports', version: '1' })
export class FinanceReportsController {
  constructor(private readonly reports: FinanceReportsService) {}

  @Get('aging')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: AgingReportDto })
  aging(@CurrentUser('companyId') companyId: string, @Query() query: AgingQueryDto) {
    return this.reports.aging(companyId, query);
  }

  @Get('summary')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: FinanceSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.reports.summary(companyId);
  }
}
