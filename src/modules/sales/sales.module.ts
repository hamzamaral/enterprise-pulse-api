import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PartnersModule } from '../partners/partners.module';
import { DeliveryNotesService } from './delivery-notes.service';
import {
  DeliveryNotesController,
  SalesInvoicesController,
  SalesOrdersController,
  SalesQuotesController,
  SalesReturnsController,
} from './sales.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersService } from './sales-orders.service';
import { SalesQuotesService } from './sales-quotes.service';
import { SalesReturnsService } from './sales-returns.service';

/** Sales: quotes → orders (stock reservation) → delivery notes → invoices → returns. */
@Module({
  imports: [InventoryModule, PartnersModule, CrmModule],
  controllers: [
    SalesQuotesController,
    SalesOrdersController,
    DeliveryNotesController,
    SalesInvoicesController,
    SalesReturnsController,
  ],
  providers: [
    SalesQuotesService,
    SalesOrdersService,
    DeliveryNotesService,
    SalesInvoicesService,
    SalesReturnsService,
  ],
})
export class SalesModule {}
