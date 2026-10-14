import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { BomsService } from './boms.service';
import { MrpService } from './mrp.service';
import { ProductionController } from './production.controller';
import { WorkOrdersService } from './work-orders.service';

/** Production (MRP): bills of materials, work orders, production records and net requirements. */
@Module({
  imports: [InventoryModule, PurchasingModule],
  controllers: [ProductionController],
  providers: [BomsService, WorkOrdersService, MrpService],
})
export class ProductionModule {}
