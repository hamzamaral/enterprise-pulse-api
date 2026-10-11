-- CreateEnum
CREATE TYPE "AssetCountStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "asset_counts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "AssetCountStatus" NOT NULL DEFAULT 'DRAFT',
    "countDate" DATE NOT NULL,
    "locationId" UUID,
    "categoryId" UUID,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_count_lines" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "expected" BOOLEAN NOT NULL DEFAULT true,
    "expectedHolder" TEXT,
    "foundAt" TIMESTAMP(3),
    "foundById" UUID,
    "condition" "AssetCondition",
    "note" TEXT,

    CONSTRAINT "asset_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_counts_companyId_status_idx" ON "asset_counts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_counts_companyId_number_key" ON "asset_counts"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "asset_count_lines_countId_assetId_key" ON "asset_count_lines"("countId", "assetId");

-- AddForeignKey
ALTER TABLE "asset_counts" ADD CONSTRAINT "asset_counts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_counts" ADD CONSTRAINT "asset_counts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "asset_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_counts" ADD CONSTRAINT "asset_counts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_counts" ADD CONSTRAINT "asset_counts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_count_lines" ADD CONSTRAINT "asset_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "asset_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_count_lines" ADD CONSTRAINT "asset_count_lines_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_count_lines" ADD CONSTRAINT "asset_count_lines_foundById_fkey" FOREIGN KEY ("foundById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
