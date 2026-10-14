-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'TREASURY_OPENING', 'PARTNER_OPENING', 'SALES_INVOICE', 'SALES_RETURN', 'PURCHASE_INVOICE', 'DELIVERY_NOTE', 'STOCK_MOVEMENT', 'COLLECTION', 'PAYMENT', 'CHEQUE', 'EXPENSE_REPORT', 'EXPENSE_PAYMENT', 'PAYROLL', 'PAYROLL_PAYMENT');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "parentId" UUID,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "JournalSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" UUID,
    "sourceNumber" TEXT,
    "description" TEXT NOT NULL,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reversesId" UUID,
    "postedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "partnerId" UUID,
    "employeeId" UUID,
    "description" TEXT,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_accounts_parentId_idx" ON "ledger_accounts"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_companyId_code_key" ON "ledger_accounts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversesId_key" ON "journal_entries"("reversesId");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_entryDate_idx" ON "journal_entries"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_source_sourceId_idx" ON "journal_entries"("companyId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_companyId_number_key" ON "journal_entries"("companyId", "number");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_partnerId_idx" ON "journal_lines"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_entryId_lineNo_key" ON "journal_lines"("entryId", "lineNo");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

