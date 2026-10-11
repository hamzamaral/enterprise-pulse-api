import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { CancelDocumentDto } from '../partners/dto/trade.dto';
import { DeliveryNotesService } from './delivery-notes.service';
import {
  ConvertQuoteDto,
  CreateDeliveryNoteDto,
  CreateSalesInvoiceDto,
  CreateSalesOrderDto,
  CreateSalesQuoteDto,
  CreateSalesReturnDto,
  DeliveryNoteDetailDto,
  DeliveryNoteDto,
  DeliveryNoteQueryDto,
  SalesInvoiceDetailDto,
  SalesInvoiceDto,
  SalesInvoiceQueryDto,
  SalesOrderDetailDto,
  SalesOrderDto,
  SalesOrderQueryDto,
  SalesQuoteDetailDto,
  SalesQuoteDto,
  SalesQuoteQueryDto,
  SalesReturnDetailDto,
  SalesReturnDto,
  SalesReturnQueryDto,
  UpdateSalesOrderDto,
} from './dto/sales.dto';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersService } from './sales-orders.service';
import { SalesQuotesService } from './sales-quotes.service';
import { SalesReturnsService } from './sales-returns.service';

@ApiTags('Sales')
@ApiBearerAuth()
@Controller({ path: 'sales-quotes', version: '1' })
export class SalesQuotesController {
  constructor(
    private readonly quotes: SalesQuotesService,
    private readonly orders: SalesOrdersService,
  ) {}

  @Get()
  @RequirePermissions('sales:read')
  @ApiOkResponse({ type: PaginatedResponseDto(SalesQuoteDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: SalesQuoteQueryDto) {
    return this.quotes.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('sales:read')
  @ApiOkResponse({ type: SalesQuoteDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('sales:create')
  @ApiOkResponse({ type: SalesQuoteDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesQuoteDto) {
    return this.quotes.create(user, dto);
  }

  /** The customer accepted: creates a DRAFT sales order from the quote. */
  @Post(':id/convert')
  @RequirePermissions('sales:create')
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async convert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertQuoteDto,
  ) {
    const { orderId } = await this.quotes.convert(user, id, dto);
    return this.orders.findOne(user.companyId, orderId);
  }

  @Post(':id/reject')
  @RequirePermissions('sales:update')
  @ApiOkResponse({ type: SalesQuoteDetailDto })
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.reject(user, id);
  }
}

@ApiTags('Sales')
@ApiBearerAuth()
@Controller({ path: 'sales-orders', version: '1' })
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermissions('sales:read')
  @ApiOkResponse({ type: PaginatedResponseDto(SalesOrderDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: SalesOrderQueryDto) {
    return this.orders.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('sales:read')
  @ApiOkResponse({ type: SalesOrderDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('sales:create')
  @ApiOkResponse({ type: SalesOrderDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesOrderDto) {
    return this.orders.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('sales:update')
  @ApiOkResponse({ type: SalesOrderDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesOrderDto,
  ) {
    return this.orders.update(user, id, dto);
  }

  /** Checks the credit limit and reserves stock. */
  @Post(':id/approve')
  @RequirePermissions('sales:approve')
  @ApiOkResponse({ type: SalesOrderDetailDto })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.approve(user, id);
  }

  /** Reserves stock that became available after approval. */
  @Post(':id/reserve')
  @RequireAnyPermission('sales:approve', 'sales:deliver')
  @ApiOkResponse({ type: SalesOrderDetailDto })
  reserve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.reserve(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('sales:update')
  @ApiOkResponse({ type: SalesOrderDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.orders.cancel(user, id, dto);
  }
}

@ApiTags('Sales')
@ApiBearerAuth()
@Controller({ path: 'delivery-notes', version: '1' })
export class DeliveryNotesController {
  constructor(private readonly deliveries: DeliveryNotesService) {}

  @Get()
  @RequirePermissions('sales:read')
  @ApiOkResponse({ type: PaginatedResponseDto(DeliveryNoteDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: DeliveryNoteQueryDto) {
    return this.deliveries.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('sales:read')
  @ApiOkResponse({ type: DeliveryNoteDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('sales:deliver')
  @ApiOkResponse({ type: DeliveryNoteDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDeliveryNoteDto) {
    return this.deliveries.create(user, dto);
  }
}

@ApiTags('Sales')
@ApiBearerAuth()
@Controller({ path: 'sales-invoices', version: '1' })
export class SalesInvoicesController {
  constructor(private readonly invoices: SalesInvoicesService) {}

  @Get()
  @RequireAnyPermission('sales:read', 'finance:read')
  @ApiOkResponse({ type: PaginatedResponseDto(SalesInvoiceDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: SalesInvoiceQueryDto) {
    return this.invoices.findAll(companyId, query);
  }

  @Get(':id')
  @RequireAnyPermission('sales:read', 'finance:read')
  @ApiOkResponse({ type: SalesInvoiceDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('sales:invoice')
  @ApiOkResponse({ type: SalesInvoiceDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesInvoiceDto) {
    return this.invoices.create(user, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('sales:invoice')
  @ApiOkResponse({ type: SalesInvoiceDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.invoices.cancel(user, id, dto);
  }
}

@ApiTags('Sales')
@ApiBearerAuth()
@Controller({ path: 'sales-returns', version: '1' })
export class SalesReturnsController {
  constructor(private readonly returns: SalesReturnsService) {}

  @Get()
  @RequireAnyPermission('sales:read', 'finance:read')
  @ApiOkResponse({ type: PaginatedResponseDto(SalesReturnDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: SalesReturnQueryDto) {
    return this.returns.findAll(companyId, query);
  }

  @Get(':id')
  @RequireAnyPermission('sales:read', 'finance:read')
  @ApiOkResponse({ type: SalesReturnDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('sales:deliver')
  @ApiOkResponse({ type: SalesReturnDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesReturnDto) {
    return this.returns.create(user, dto);
  }
}
