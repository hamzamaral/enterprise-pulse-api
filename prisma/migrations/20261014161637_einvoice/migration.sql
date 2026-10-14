-- CreateEnum
CREATE TYPE "EInvoiceDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- CreateEnum
CREATE TYPE "EInvoiceProfile" AS ENUM ('TEMELFATURA', 'TICARIFATURA', 'EARSIVFATURA');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'ACCEPTED', 'REJECTED', 'ERROR', 'CANCELLED');

-- AlterTable
ALTER TABLE "business_partners" ADD COLUMN     "eInvoiceAlias" TEXT;

-- CreateTable
CREATE TABLE "e_invoices" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "direction" "EInvoiceDirection" NOT NULL,
    "profile" "EInvoiceProfile" NOT NULL,
    "status" "EInvoiceStatus" NOT NULL,
    "number" TEXT NOT NULL,
    "uuid" UUID NOT NULL,
    "salesInvoiceId" UUID,
    "purchaseInvoiceId" UUID,
    "partnerId" UUID NOT NULL,
    "issueDate" DATE NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,6) NOT NULL,
    "lineExtensionAmount" DECIMAL(18,2) NOT NULL,
    "allowanceTotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "payableAmount" DECIMAL(18,2) NOT NULL,
    "senderAlias" TEXT,
    "receiverAlias" TEXT,
    "senderTaxId" TEXT,
    "receiverTaxId" TEXT,
    "lines" JSONB NOT NULL,
    "xml" TEXT NOT NULL,
    "statusCode" TEXT,
    "statusMessage" TEXT,
    "responseNote" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "e_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e_invoice_events" (
    "id" UUID NOT NULL,
    "eInvoiceId" UUID NOT NULL,
    "status" "EInvoiceStatus" NOT NULL,
    "code" TEXT,
    "message" TEXT NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "e_invoice_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "e_invoices_uuid_key" ON "e_invoices"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "e_invoices_salesInvoiceId_key" ON "e_invoices"("salesInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "e_invoices_purchaseInvoiceId_key" ON "e_invoices"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "e_invoices_companyId_direction_status_idx" ON "e_invoices"("companyId", "direction", "status");

-- CreateIndex
CREATE UNIQUE INDEX "e_invoices_companyId_direction_number_key" ON "e_invoices"("companyId", "direction", "number");

-- CreateIndex
CREATE INDEX "e_invoice_events_eInvoiceId_createdAt_idx" ON "e_invoice_events"("eInvoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "e_invoices" ADD CONSTRAINT "e_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_invoices" ADD CONSTRAINT "e_invoices_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_invoices" ADD CONSTRAINT "e_invoices_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_invoices" ADD CONSTRAINT "e_invoices_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_invoices" ADD CONSTRAINT "e_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_invoice_events" ADD CONSTRAINT "e_invoice_events_eInvoiceId_fkey" FOREIGN KEY ("eInvoiceId") REFERENCES "e_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_invoice_events" ADD CONSTRAINT "e_invoice_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

