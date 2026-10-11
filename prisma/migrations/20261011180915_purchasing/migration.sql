-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ORDERED');

-- CreateEnum
CREATE TYPE "SupplierQuoteStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "neededBy" DATE,
    "departmentId" UUID,
    "notes" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'PENDING',
    "workflowInstanceId" UUID,
    "decidedAt" TIMESTAMP(3),
    "requestedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_lines" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "variantId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "estimatedPrice" DECIMAL(18,4),

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "requestId" UUID,
    "partnerId" UUID NOT NULL,
    "quoteDate" DATE NOT NULL,
    "validUntil" DATE,
    "deliveryDays" INTEGER,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,6) NOT NULL,
    "status" "SupplierQuoteStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "grandTotal" DECIMAL(18,2) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quote_lines" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "requestLineId" UUID,
    "variantId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" UUID NOT NULL,
    "requestId" UUID,
    "quoteId" UUID,
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "warehouseId" UUID NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,6) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "grandTotal" DECIMAL(18,2) NOT NULL,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "requestLineId" UUID,
    "variantId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "receivedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "invoicedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "receiptDate" DATE NOT NULL,
    "deliveryNoteNo" TEXT,
    "notes" TEXT,
    "stockMovementId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "lotNo" TEXT,
    "expiryDate" DATE,
    "serialNos" TEXT[],

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT NOT NULL,
    "partnerId" UUID NOT NULL,
    "orderId" UUID,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,6) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "grandTotal" DECIMAL(18,2) NOT NULL,
    "createdById" UUID NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineId" UUID,
    "variantId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_requests_companyId_status_idx" ON "purchase_requests"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_companyId_number_key" ON "purchase_requests"("companyId", "number");

-- CreateIndex
CREATE INDEX "purchase_request_lines_requestId_idx" ON "purchase_request_lines"("requestId");

-- CreateIndex
CREATE INDEX "supplier_quotes_requestId_idx" ON "supplier_quotes"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_companyId_number_key" ON "supplier_quotes"("companyId", "number");

-- CreateIndex
CREATE INDEX "supplier_quote_lines_quoteId_idx" ON "supplier_quote_lines"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_quoteId_key" ON "purchase_orders"("quoteId");

-- CreateIndex
CREATE INDEX "purchase_orders_companyId_status_idx" ON "purchase_orders"("companyId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_partnerId_idx" ON "purchase_orders"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_companyId_number_key" ON "purchase_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_orderId_idx" ON "purchase_order_lines"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_stockMovementId_key" ON "goods_receipts"("stockMovementId");

-- CreateIndex
CREATE INDEX "goods_receipts_orderId_idx" ON "goods_receipts"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_companyId_number_key" ON "goods_receipts"("companyId", "number");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_receiptId_idx" ON "goods_receipt_lines"("receiptId");

-- CreateIndex
CREATE INDEX "purchase_invoices_companyId_partnerId_status_idx" ON "purchase_invoices"("companyId", "partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_companyId_number_key" ON "purchase_invoices"("companyId", "number");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_invoiceId_idx" ON "purchase_invoice_lines"("invoiceId");

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "purchase_request_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "supplier_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "purchase_request_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
