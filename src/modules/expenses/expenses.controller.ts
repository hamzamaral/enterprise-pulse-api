import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { DownloadUrlDto, FileDto } from '../files/dto/file.dto';
import { MAX_FILE_SIZE } from '../files/files.service';
import { CancelDocumentDto } from '../partners/dto/trade.dto';
import {
  CreateExpenseCategoryDto,
  CreateExpenseReportDto,
  ExpenseCategoryDto,
  ExpenseReportDetailDto,
  ExpenseReportDto,
  ExpenseReportQueryDto,
  ExpenseSummaryDto,
  PayExpenseReportDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseReportDto,
} from './dto/expense.dto';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseReportsService } from './expense-reports.service';

@ApiTags('Expenses')
@ApiBearerAuth()
@Controller({ path: 'expense-categories', version: '1' })
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  /** Open to every employee for the expense form. */
  @Get()
  @ApiOkResponse({ type: [ExpenseCategoryDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.categories.findAll(companyId);
  }

  @Post()
  @RequirePermissions('expenses:update')
  @ApiOkResponse({ type: ExpenseCategoryDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateExpenseCategoryDto) {
    return this.categories.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('expenses:update')
  @ApiOkResponse({ type: ExpenseCategoryDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.categories.update(companyId, id, dto);
  }
}

/**
 * Self-service: anyone with an employee record files and follows their own reports; the service
 * widens access with `expenses:read`, `expenses:create` and `expenses:pay`.
 */
@ApiTags('Expenses')
@ApiBearerAuth()
@Controller({ path: 'expense-reports', version: '1' })
export class ExpenseReportsController {
  constructor(private readonly reports: ExpenseReportsService) {}

  @Get()
  @ApiOkResponse({ type: PaginatedResponseDto(ExpenseReportDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: ExpenseReportQueryDto) {
    return this.reports.findAll(user, query);
  }

  @Get('summary')
  @ApiOkResponse({ type: ExpenseSummaryDto })
  summary(@CurrentUser() user: AuthUser) {
    return this.reports.summary(user);
  }

  /** Upload a receipt first, then reference it as `receiptFileId` on a line. */
  @Post('receipts')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: FileDto })
  uploadReceipt(
    @CurrentUser() user: AuthUser,
    @UploadedFile(
      new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }),
    )
    file: Express.Multer.File,
  ) {
    return this.reports.uploadReceipt(user, file);
  }

  @Get(':id')
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.findOne(user, id);
  }

  @Get(':id/lines/:lineId/receipt-url')
  @ApiOkResponse({ type: DownloadUrlDto })
  receiptUrl(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.reports.receiptUrl(user, id, lineId);
  }

  @Post()
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseReportDto) {
    return this.reports.create(user, dto);
  }

  @Put(':id')
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseReportDto,
  ) {
    return this.reports.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.remove(user, id);
  }

  @Post(':id/submit')
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.submit(user, id);
  }

  @Post(':id/withdraw')
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.withdraw(user, id);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.reports.cancel(user, id, dto.reason);
  }

  @Post(':id/pay')
  @RequirePermissions('expenses:pay')
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayExpenseReportDto,
  ) {
    return this.reports.pay(user, id, dto);
  }

  @Post(':id/reverse-payment')
  @RequirePermissions('expenses:pay')
  @ApiOkResponse({ type: ExpenseReportDetailDto })
  reversePayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.reversePayment(user, id);
  }
}
