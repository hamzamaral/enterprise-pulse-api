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
import {
  CreateProductCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  CreateWarehouseDto,
  ProductCategoryDto,
  ProductDetailDto,
  ProductDto,
  ProductQueryDto,
  UpdateProductCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  UpdateWarehouseDto,
  WarehouseDto,
} from './dto/catalog.dto';
import {
  AddCountLineDto,
  CreateStockCountDto,
  CreateStockMovementDto,
  LedgerEntryDto,
  LedgerQueryDto,
  LotQueryDto,
  LotStockDto,
  MovementQueryDto,
  SerialDto,
  SerialQueryDto,
  StockCountDetailDto,
  StockCountDto,
  StockCountQueryDto,
  StockItemDto,
  StockItemQueryDto,
  StockLevelDto,
  StockLevelQueryDto,
  StockMovementDetailDto,
  StockMovementDto,
  StockSummaryDto,
  UpdateCountLinesDto,
} from './dto/stock.dto';
import { InventorySettingsService } from './inventory-settings.service';
import { ProductsService } from './products.service';
import { StockCountsService } from './stock-counts.service';
import { StockMovementsService } from './stock-movements.service';
import { StockService } from './stock.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'product-categories', version: '1' })
export class ProductCategoriesController {
  constructor(private readonly settings: InventorySettingsService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: [ProductCategoryDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.settings.findCategories(companyId);
  }

  @Post()
  @RequirePermissions('inventory:create')
  @ApiOkResponse({ type: ProductCategoryDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateProductCategoryDto) {
    return this.settings.createCategory(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('inventory:update')
  @ApiOkResponse({ type: ProductCategoryDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return this.settings.updateCategory(companyId, id, dto);
  }
}

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly settings: InventorySettingsService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: [WarehouseDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.settings.findWarehouses(companyId);
  }

  @Post()
  @RequirePermissions('inventory:create')
  @ApiOkResponse({ type: WarehouseDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateWarehouseDto) {
    return this.settings.createWarehouse(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('inventory:update')
  @ApiOkResponse({ type: WarehouseDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.settings.updateWarehouse(companyId, id, dto);
  }
}

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: PaginatedResponseDto(ProductDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: ProductQueryDto) {
    return this.products.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: ProductDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('inventory:create')
  @ApiOkResponse({ type: ProductDetailDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateProductDto) {
    return this.products.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('inventory:update')
  @ApiOkResponse({ type: ProductDetailDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('inventory:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.remove(companyId, id);
  }

  @Post(':id/variants')
  @RequirePermissions('inventory:update')
  @ApiOkResponse({ type: ProductDetailDto })
  addVariant(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.products.addVariant(companyId, id, dto);
  }

  @Patch(':id/variants/:variantId')
  @RequirePermissions('inventory:update')
  @ApiOkResponse({ type: ProductDetailDto })
  updateVariant(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.products.updateVariant(companyId, id, variantId, dto);
  }

  @Delete(':id/variants/:variantId')
  @RequirePermissions('inventory:update')
  @ApiOkResponse({ type: ProductDetailDto })
  removeVariant(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.products.removeVariant(companyId, id, variantId);
  }
}

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'stock', version: '1' })
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly products: ProductsService,
  ) {}

  @Get('items')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: [StockItemDto] })
  findItems(@CurrentUser('companyId') companyId: string, @Query() query: StockItemQueryDto) {
    return this.products.findItems(companyId, query);
  }

  @Get('levels')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: PaginatedResponseDto(StockLevelDto) })
  findLevels(@CurrentUser('companyId') companyId: string, @Query() query: StockLevelQueryDto) {
    return this.stock.findLevels(companyId, query);
  }

  @Get('summary')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: StockSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.stock.summary(companyId);
  }

  @Get('lots')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: [LotStockDto] })
  findLots(@CurrentUser('companyId') companyId: string, @Query() query: LotQueryDto) {
    return this.stock.findLots(companyId, query);
  }

  @Get('serials')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: [SerialDto] })
  findSerials(@CurrentUser('companyId') companyId: string, @Query() query: SerialQueryDto) {
    return this.stock.findSerials(companyId, query);
  }

  @Get('ledger')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: PaginatedResponseDto(LedgerEntryDto) })
  findLedger(@CurrentUser('companyId') companyId: string, @Query() query: LedgerQueryDto) {
    return this.stock.findLedger(companyId, query);
  }
}

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'stock-movements', version: '1' })
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: PaginatedResponseDto(StockMovementDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: MovementQueryDto) {
    return this.movements.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: StockMovementDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.movements.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('inventory:move')
  @ApiOkResponse({ type: StockMovementDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStockMovementDto) {
    return this.movements.create(user, dto);
  }
}

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'stock-counts', version: '1' })
export class StockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: PaginatedResponseDto(StockCountDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: StockCountQueryDto) {
    return this.counts.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('inventory:read')
  @ApiOkResponse({ type: StockCountDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.counts.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('inventory:count')
  @ApiOkResponse({ type: StockCountDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStockCountDto) {
    return this.counts.create(user, dto);
  }

  @Patch(':id/lines')
  @RequirePermissions('inventory:count')
  @ApiOkResponse({ type: StockCountDetailDto })
  updateLines(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCountLinesDto,
  ) {
    return this.counts.updateLines(companyId, id, dto);
  }

  @Post(':id/lines')
  @RequirePermissions('inventory:count')
  @ApiOkResponse({ type: StockCountDetailDto })
  addLine(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCountLineDto,
  ) {
    return this.counts.addLine(companyId, id, dto);
  }

  /** Posts the counted differences as a stock adjustment (needs `inventory:move` too). */
  @Post(':id/complete')
  @RequirePermissions('inventory:count', 'inventory:move')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StockCountDetailDto })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.counts.complete(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('inventory:count')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StockCountDetailDto })
  cancel(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.counts.cancel(companyId, id);
  }
}
