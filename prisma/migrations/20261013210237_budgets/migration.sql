-- CreateEnum
CREATE TYPE "BudgetItemKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "BudgetSource" AS ENUM ('MANUAL', 'EXPENSES', 'PAYROLL', 'PURCHASES', 'SALES');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "BudgetEventType" AS ENUM ('CREATED', 'UPDATED', 'PLAN_UPDATED', 'APPROVED', 'REOPENED', 'ALERT_SENT');

-- CreateEnum
CREATE TYPE "BudgetAlertLevel" AS ENUM ('WARNING', 'OVER');

-- CreateTable
CREATE TABLE "budget_items" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BudgetItemKind" NOT NULL,
    "source" "BudgetSource" NOT NULL DEFAULT 'MANUAL',
    "categoryIds" UUID[],
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "departmentId" UUID,
    "name" TEXT NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" UUID,
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "departmentId" UUID,
    "entryDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_events" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "actorId" UUID,
    "type" "BudgetEventType" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_alerts" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "level" "BudgetAlertLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_items_companyId_code_key" ON "budget_items"("companyId", "code");

-- CreateIndex
CREATE INDEX "budgets_companyId_year_idx" ON "budgets"("companyId", "year");

-- CreateIndex
CREATE INDEX "budgets_departmentId_idx" ON "budgets"("departmentId");

-- CreateIndex
CREATE INDEX "budget_lines_itemId_idx" ON "budget_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_budgetId_itemId_month_key" ON "budget_lines"("budgetId", "itemId", "month");

-- CreateIndex
CREATE INDEX "budget_entries_companyId_entryDate_idx" ON "budget_entries"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "budget_entries_itemId_idx" ON "budget_entries"("itemId");

-- CreateIndex
CREATE INDEX "budget_events_budgetId_idx" ON "budget_events"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_alerts_budgetId_itemId_level_key" ON "budget_alerts"("budgetId", "itemId", "level");

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "budget_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "budget_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "budget_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
