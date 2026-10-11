import { Module } from '@nestjs/common';
import {
  ProductCategoriesController,
  ProductsController,
  StockController,
  StockCountsController,
  StockMovementsController,
  WarehousesController,
} from './inventory.controller';
import { InventorySettingsService } from './inventory-settings.service';
import { ProductsService } from './products.service';
import { StockCountsService } from './stock-counts.service';
import { StockMovementsService } from './stock-movements.service';
import { StockService } from './stock.service';

/** Stock & warehouses: products/variants, warehouses, movements with lots and serials, counts. */
@Module({
  controllers: [
    ProductCategoriesController,
    WarehousesController,
    ProductsController,
    StockController,
    StockMovementsController,
    StockCountsController,
  ],
  providers: [
    InventorySettingsService,
    ProductsService,
    StockService,
    StockMovementsService,
    StockCountsService,
  ],
  exports: [StockMovementsService],
})
export class InventoryModule {}
