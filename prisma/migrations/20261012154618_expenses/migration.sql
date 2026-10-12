-- CreateEnum
CREATE TYPE "ExpenseCategoryKind" AS ENUM ('RECEIPT', 'PER_DIEM', 'MILEAGE');

-- CreateEnum
CREATE TYPE "ExpenseReportStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TreasuryDocumentType" ADD VALUE 'EXPENSE_PAYMENT';

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ExpenseCategoryKind" NOT NULL DEFAULT 'RECEIPT',
    "rate" DECIMAL(18,2),
    "limitAmount" DECIMAL(18,2),
    "requiresReceipt" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_reports" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "employeeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ExpenseReportStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "workflowInstanceId" UUID,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "paymentAccountId" UUID,
    "paymentDate" DATE,
    "paidAt" TIMESTAMP(3),
    "paidById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_lines" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "categoryId" UUID NOT NULL,
    "expenseDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "quantity" DECIMAL(18,2) NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "amountBase" DECIMAL(18,2) NOT NULL,
    "receiptFileId" UUID,

    CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_companyId_code_key" ON "expense_categories"("companyId", "code");

-- CreateIndex
CREATE INDEX "expense_reports_companyId_status_idx" ON "expense_reports"("companyId", "status");

-- CreateIndex
CREATE INDEX "expense_reports_employeeId_idx" ON "expense_reports"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_reports_companyId_number_key" ON "expense_reports"("companyId", "number");

-- CreateIndex
CREATE INDEX "expense_lines_categoryId_idx" ON "expense_lines"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_lines_reportId_lineNo_key" ON "expense_lines"("reportId", "lineNo");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "treasury_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "expense_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
