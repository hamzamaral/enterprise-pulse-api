-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "LedgerDocumentType" AS ENUM ('OPENING', 'PURCHASE_INVOICE', 'SALES_INVOICE', 'SALES_RETURN', 'COLLECTION', 'PAYMENT');

-- CreateTable
CREATE TABLE "business_partners" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "contactName" TEXT,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 30,
    "currencyCode" TEXT NOT NULL DEFAULT 'TRY',
    "creditLimit" DECIMAL(18,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "business_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_ledger_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "companyId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "dueDate" DATE,
    "documentType" "LedgerDocumentType" NOT NULL,
    "documentId" UUID,
    "documentNumber" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "debitBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reversesId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_partners_companyId_type_idx" ON "business_partners"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_companyId_code_key" ON "business_partners"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_ledger_entries_reversesId_key" ON "partner_ledger_entries"("reversesId");

-- CreateIndex
CREATE INDEX "partner_ledger_entries_companyId_partnerId_seq_idx" ON "partner_ledger_entries"("companyId", "partnerId", "seq");

-- CreateIndex
CREATE INDEX "partner_ledger_entries_documentType_documentId_idx" ON "partner_ledger_entries"("documentType", "documentId");

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "partner_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
