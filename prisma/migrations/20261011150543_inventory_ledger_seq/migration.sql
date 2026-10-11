-- DropIndex
DROP INDEX "stock_transactions_companyId_variantId_createdAt_idx";

-- AlterTable
ALTER TABLE "stock_transactions" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "stock_transactions_companyId_variantId_seq_idx" ON "stock_transactions"("companyId", "variantId", "seq");
