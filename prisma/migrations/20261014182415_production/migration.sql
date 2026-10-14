-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'PRODUCTION';

-- CreateTable
CREATE TABLE "bills_of_materials" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "laborCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_of_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_lines" (
    "id" UUID NOT NULL,
    "bomId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "scrapRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "bomId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "producedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedStart" DATE NOT NULL,
    "plannedEnd" DATE NOT NULL,
    "sourceWarehouseId" UUID NOT NULL,
    "targetWarehouseId" UUID NOT NULL,
    "laborPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overheadPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_components" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "variantId" UUID NOT NULL,
    "quantityPer" DECIMAL(18,6) NOT NULL,
    "requiredQty" DECIMAL(18,3) NOT NULL,
    "consumedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_records" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "materialCost" DECIMAL(18,2) NOT NULL,
    "laborCost" DECIMAL(18,2) NOT NULL,
    "overheadCost" DECIMAL(18,2) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "issueMovementId" UUID,
    "receiptMovementId" UUID NOT NULL,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bills_of_materials_companyId_variantId_idx" ON "bills_of_materials"("companyId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_of_materials_companyId_code_key" ON "bills_of_materials"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bom_lines_bomId_variantId_key" ON "bom_lines"("bomId", "variantId");

-- CreateIndex
CREATE INDEX "work_orders_companyId_status_idx" ON "work_orders"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_companyId_number_key" ON "work_orders"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_components_workOrderId_variantId_key" ON "work_order_components"("workOrderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "production_records_issueMovementId_key" ON "production_records"("issueMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "production_records_receiptMovementId_key" ON "production_records"("receiptMovementId");

-- CreateIndex
CREATE INDEX "production_records_workOrderId_idx" ON "production_records"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "production_records_companyId_number_key" ON "production_records"("companyId", "number");

-- AddForeignKey
ALTER TABLE "bills_of_materials" ADD CONSTRAINT "bills_of_materials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_materials" ADD CONSTRAINT "bills_of_materials_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_materials" ADD CONSTRAINT "bills_of_materials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "bills_of_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "bills_of_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_components" ADD CONSTRAINT "work_order_components_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_components" ADD CONSTRAINT "work_order_components_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_issueMovementId_fkey" FOREIGN KEY ("issueMovementId") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_receiptMovementId_fkey" FOREIGN KEY ("receiptMovementId") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

