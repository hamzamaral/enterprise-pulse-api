import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  AcceptQuoteDto,
  CancelDocumentDto,
  CreateGoodsReceiptDto,
  CreatePurchaseInvoiceDto,
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  CreateSupplierQuoteDto,
  GoodsReceiptDetailDto,
  GoodsReceiptDto,
  GoodsReceiptQueryDto,
  PurchaseInvoiceDetailDto,
  PurchaseInvoiceDto,
  PurchaseInvoiceQueryDto,
  PurchaseOrderDetailDto,
  PurchaseOrderDto,
  PurchaseOrderQueryDto,
  PurchaseRequestDetailDto,
  PurchaseRequestDto,
  PurchaseRequestQueryDto,
  QuoteComparisonDto,
  SupplierQuoteDetailDto,
  SupplierQuoteDto,
  SupplierQuoteQueryDto,
  UpdatePurchaseOrderDto,
} from './dto/purchasing.dto';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { SupplierQuotesService } from './supplier-quotes.service';

/** Employees request through the workflow; buyers request directly. */
const REQUESTERS = ['workflow:start', 'purchasing:create'];

@ApiTags('Purchasing')
@ApiBearerAuth()
@Controller({ path: 'purchase-requests', version: '1' })
export class PurchaseRequestsController {
  constructor(
    private readonly requests: PurchaseRequestsService,
    private readonly quotes: SupplierQuotesService,
  ) {}

  /** Without `purchasing:read` only the caller's own requests are listed. */
  @Get()
  @RequireAnyPermission(...REQUESTERS, 'purchasing:read')
  @ApiOkResponse({ type: PaginatedResponseDto(PurchaseRequestDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: PurchaseRequestQueryDto) {
    return this.requests.findAll(user, query);
  }

  @Get(':id')
  @RequireAnyPermission(...REQUESTERS, 'purchasing:read')
  @ApiOkResponse({ type: PurchaseRequestDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.findOne(user, id);
  }

  @Get(':id/comparison')
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: QuoteComparisonDto })
  comparison(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.compare(companyId, id);
  }

  @Post()
  @RequireAnyPermission(...REQUESTERS)
  @ApiOkResponse({ type: PurchaseRequestDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseRequestDto) {
    return this.requests.create(user, dto);
  }

  @Post(':id/cancel')
  @RequireAnyPermission(...REQUESTERS)
  @ApiOkResponse({ type: PurchaseRequestDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.requests.cancel(user, id, dto);
  }
}

@ApiTags('Purchasing')
@ApiBearerAuth()
@Controller({ path: 'supplier-quotes', version: '1' })
export class SupplierQuotesController {
  constructor(
    private readonly quotes: SupplierQuotesService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  @Get()
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: PaginatedResponseDto(SupplierQuoteDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: SupplierQuoteQueryDto) {
    return this.quotes.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: SupplierQuoteDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('purchasing:create')
  @ApiOkResponse({ type: SupplierQuoteDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSupplierQuoteDto) {
    return this.quotes.create(user, dto);
  }

  /** Creates a DRAFT purchase order from the quote. */
  @Post(':id/accept')
  @RequirePermissions('purchasing:create')
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptQuoteDto,
  ) {
    const { orderId } = await this.quotes.accept(user, id, dto);
    return this.orders.findOne(user.companyId, orderId);
  }

  @Post(':id/reject')
  @RequirePermissions('purchasing:update')
  @ApiOkResponse({ type: SupplierQuoteDetailDto })
  reject(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.reject(companyId, id);
  }
}

@ApiTags('Purchasing')
@ApiBearerAuth()
@Controller({ path: 'purchase-orders', version: '1' })
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: PaginatedResponseDto(PurchaseOrderDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PurchaseOrderQueryDto) {
    return this.orders.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('purchasing:create')
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.orders.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('purchasing:update')
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.orders.update(user, id, dto);
  }

  @Post(':id/approve')
  @RequirePermissions('purchasing:approve')
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.approve(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('purchasing:update')
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.orders.cancel(user, id, dto);
  }
}

@ApiTags('Purchasing')
@ApiBearerAuth()
@Controller({ path: 'goods-receipts', version: '1' })
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: PaginatedResponseDto(GoodsReceiptDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: GoodsReceiptQueryDto) {
    return this.receipts.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: GoodsReceiptDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('purchasing:receive')
  @ApiOkResponse({ type: GoodsReceiptDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGoodsReceiptDto) {
    return this.receipts.create(user, dto);
  }
}

@ApiTags('Purchasing')
@ApiBearerAuth()
@Controller({ path: 'purchase-invoices', version: '1' })
export class PurchaseInvoicesController {
  constructor(private readonly invoices: PurchaseInvoicesService) {}

  @Get()
  @RequireAnyPermission('purchasing:read', 'finance:read')
  @ApiOkResponse({ type: PaginatedResponseDto(PurchaseInvoiceDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PurchaseInvoiceQueryDto) {
    return this.invoices.findAll(companyId, query);
  }

  @Get(':id')
  @RequireAnyPermission('purchasing:read', 'finance:read')
  @ApiOkResponse({ type: PurchaseInvoiceDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('purchasing:create')
  @ApiOkResponse({ type: PurchaseInvoiceDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseInvoiceDto) {
    return this.invoices.create(user, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('purchasing:update')
  @ApiOkResponse({ type: PurchaseInvoiceDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.invoices.cancel(user, id, dto);
  }
}
