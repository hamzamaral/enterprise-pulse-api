import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingReportsService } from './accounting-reports.service';
import {
  AccountingOptionsDto,
  AccountingSettingsDto,
  AccountingSummaryDto,
  AccountLedgerDto,
  AccountLedgerQueryDto,
  BalanceSheetDto,
  BalanceSheetQueryDto,
  CreateLedgerAccountDto,
  DateRangeQueryDto,
  IncomeStatementDto,
  InstallChartResultDto,
  JournalEntryDetailDto,
  JournalEntryDto,
  JournalQueryDto,
  LedgerAccountDto,
  PendingPostingDto,
  PostingRunResultDto,
  ReverseJournalEntryDto,
  SaveJournalEntryDto,
  SummaryQueryDto,
  TrialBalanceDto,
  TrialBalanceQueryDto,
  UpdateAccountingSettingsDto,
  UpdateLedgerAccountDto,
} from './dto/accounting.dto';
import { JournalService } from './journal.service';
import { LedgerAccountsService } from './ledger-accounts.service';

@ApiTags('Accounting')
@ApiBearerAuth()
@Controller({ path: 'accounting', version: '1' })
export class AccountingController {
  constructor(
    private readonly reports: AccountingReportsService,
    private readonly posting: AccountingPostingService,
  ) {}

  @Get('summary')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: AccountingSummaryDto })
  summary(@CurrentUser('companyId') companyId: string, @Query() query: SummaryQueryDto) {
    return this.reports.summary(companyId, query.year);
  }

  /** Accounts, partners and employees for the entry form. */
  @Get('options')
  @RequirePermissions('accounting:update')
  @ApiOkResponse({ type: AccountingOptionsDto })
  options(@CurrentUser('companyId') companyId: string) {
    return this.reports.options(companyId);
  }

  @Get('settings')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: AccountingSettingsDto })
  settings(@CurrentUser('companyId') companyId: string) {
    return this.reports.settings(companyId);
  }

  /** Dönem kilidi. */
  @Patch('settings')
  @RequirePermissions('accounting:close')
  @ApiOkResponse({ type: AccountingSettingsDto })
  updateSettings(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateAccountingSettingsDto,
  ) {
    return this.reports.updateSettings(companyId, dto);
  }

  /** Source documents waiting to be posted, reversed or re-posted. */
  @Get('pending')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: [PendingPostingDto] })
  pending(@CurrentUser('companyId') companyId: string) {
    return this.posting.pending(companyId);
  }

  /** Muhasebeleştir: posts every pending document now (the daily job does the same). */
  @Post('run')
  @RequirePermissions('accounting:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PostingRunResultDto })
  run(@CurrentUser() user: AuthUser) {
    return this.posting.run(user.companyId, user.id);
  }

  @Get('trial-balance')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: TrialBalanceDto })
  trialBalance(@CurrentUser('companyId') companyId: string, @Query() query: TrialBalanceQueryDto) {
    return this.reports.trialBalance(companyId, query);
  }

  @Get('balance-sheet')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: BalanceSheetDto })
  balanceSheet(@CurrentUser('companyId') companyId: string, @Query() query: BalanceSheetQueryDto) {
    return this.reports.balanceSheet(companyId, query);
  }

  @Get('income-statement')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: IncomeStatementDto })
  incomeStatement(@CurrentUser('companyId') companyId: string, @Query() query: DateRangeQueryDto) {
    return this.reports.incomeStatement(companyId, query);
  }
}

@ApiTags('Accounting')
@ApiBearerAuth()
@Controller({ path: 'ledger-accounts', version: '1' })
export class LedgerAccountsController {
  constructor(private readonly accounts: LedgerAccountsService) {}

  @Get()
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: [LedgerAccountDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.accounts.list(companyId);
  }

  /** Adds the missing accounts of the standard chart. */
  @Post('install')
  @RequirePermissions('accounting:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: InstallChartResultDto })
  install(@CurrentUser('companyId') companyId: string) {
    return this.accounts.install(companyId);
  }

  @Post()
  @RequirePermissions('accounting:update')
  @ApiOkResponse({ type: LedgerAccountDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateLedgerAccountDto) {
    return this.accounts.create(companyId, dto);
  }

  /** Muavin defter of the account and its sub-accounts. */
  @Get(':id/ledger')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: AccountLedgerDto })
  ledger(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AccountLedgerQueryDto,
  ) {
    return this.accounts.ledger(companyId, id, query);
  }

  @Patch(':id')
  @RequirePermissions('accounting:update')
  @ApiOkResponse({ type: LedgerAccountDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLedgerAccountDto,
  ) {
    return this.accounts.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('accounting:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.remove(companyId, id);
  }
}

@ApiTags('Accounting')
@ApiBearerAuth()
@Controller({ path: 'journal-entries', version: '1' })
export class JournalEntriesController {
  constructor(private readonly journal: JournalService) {}

  /** Yevmiye defteri. */
  @Get()
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: PaginatedResponseDto(JournalEntryDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: JournalQueryDto) {
    return this.journal.list(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('accounting:read')
  @ApiOkResponse({ type: JournalEntryDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journal.findOne(user, id);
  }

  @Post()
  @RequirePermissions('accounting:update')
  @ApiOkResponse({ type: JournalEntryDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveJournalEntryDto) {
    return this.journal.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('accounting:update')
  @ApiOkResponse({ type: JournalEntryDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveJournalEntryDto,
  ) {
    return this.journal.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('accounting:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journal.remove(user, id);
  }

  @Post(':id/post')
  @RequirePermissions('accounting:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: JournalEntryDetailDto })
  post(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journal.post(user, id);
  }

  /** Returns the reversing entry. */
  @Post(':id/reverse')
  @RequirePermissions('accounting:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: JournalEntryDetailDto })
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalEntryDto,
  ) {
    return this.journal.reverse(user, id, dto);
  }
}
