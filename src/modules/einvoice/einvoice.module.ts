import { Module } from '@nestjs/common';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { EInvoiceController } from './einvoice.controller';
import { EInvoiceListener } from './einvoice.listener';
import { EInvoiceProcessor } from './einvoice.processor';
import { EInvoiceService } from './einvoice.service';

/** e-Fatura / e-Arşiv simulation: UBL-TR documents, GİB states and receiver responses. */
@Module({
  imports: [PurchasingModule],
  controllers: [EInvoiceController],
  providers: [EInvoiceService, EInvoiceProcessor, EInvoiceListener],
})
export class EInvoiceModule {}
