import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PartnersModule } from '../partners/partners.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import {
  GoodsReceiptsController,
  PurchaseInvoicesController,
  PurchaseOrdersController,
  PurchaseRequestsController,
  SupplierQuotesController,
} from './purchasing.controller';
import { PurchasingListener } from './purchasing.listener';
import { SupplierQuotesService } from './supplier-quotes.service';

/** Purchasing: requests → supplier quotes → orders → goods receipts → invoices. */
@Module({
  imports: [WorkflowModule, InventoryModule, PartnersModule],
  controllers: [
    PurchaseRequestsController,
    SupplierQuotesController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    PurchaseInvoicesController,
  ],
  providers: [
    PurchaseRequestsService,
    SupplierQuotesService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    PurchaseInvoicesService,
    PurchasingListener,
  ],
  exports: [PurchaseInvoicesService, PurchaseRequestsService],
})
export class PurchasingModule {}
