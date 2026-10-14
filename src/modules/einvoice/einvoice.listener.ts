import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SALES_EVENTS, type SalesInvoiceCreatedEvent } from '../sales/sales.events';
import { EInvoiceService } from './einvoice.service';

/** Sends new sales invoices when automatic sending is switched on. */
@Injectable()
export class EInvoiceListener {
  constructor(private readonly einvoice: EInvoiceService) {}

  @OnEvent(SALES_EVENTS.INVOICE_CREATED)
  onInvoiceCreated(event: SalesInvoiceCreatedEvent) {
    return this.einvoice.autoSend(event.user, event.invoiceId);
  }
}
