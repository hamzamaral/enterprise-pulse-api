import type { AuthUser } from '../../common/auth/auth-user';

export const SALES_EVENTS = {
  INVOICE_CREATED: 'sales.invoice.created',
} as const;

/** Emitted after a sales invoice is issued; the e-invoice module may send it automatically. */
export interface SalesInvoiceCreatedEvent {
  user: AuthUser;
  invoiceId: string;
}
