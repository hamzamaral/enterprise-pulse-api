-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "PayslipItemKind" AS ENUM ('EARNING', 'DEDUCTION');

-- AlterEnum
ALTER TYPE "TreasuryDocumentType" ADD VALUE 'PAYROLL_PAYMENT';

-- CreateTable
CREATE TABLE "salary_records" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "grossSalary" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_parameters" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "minimumWage" DECIMAL(18,2) NOT NULL,
    "sgkCeiling" DECIMAL(18,2) NOT NULL,
    "sgkEmployeeRate" DECIMAL(6,4) NOT NULL,
    "unemploymentEmployeeRate" DECIMAL(6,4) NOT NULL,
    "sgkEmployerRate" DECIMAL(6,4) NOT NULL,
    "unemploymentEmployerRate" DECIMAL(6,4) NOT NULL,
    "stampTaxRate" DECIMAL(8,6) NOT NULL,
    "overtimeRate" DECIMAL(4,2) NOT NULL DEFAULT 1.5,
    "monthlyHours" INTEGER NOT NULL DEFAULT 225,
    "taxBrackets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgkTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductionTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerCostTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "paymentAccountId" UUID,
    "paymentDate" DATE,
    "paidAt" TIMESTAMP(3),
    "paidById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "departmentName" TEXT,
    "positionName" TEXT,
    "monthlySalary" DECIMAL(18,2) NOT NULL,
    "employedDays" INTEGER NOT NULL,
    "missingDays" INTEGER NOT NULL DEFAULT 0,
    "payDays" INTEGER NOT NULL,
    "overtimeHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "basePay" DECIMAL(18,2) NOT NULL,
    "overtimePay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "extraEarnings" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(18,2) NOT NULL,
    "sgkBase" DECIMAL(18,2) NOT NULL,
    "sgkEmployee" DECIMAL(18,2) NOT NULL,
    "unemploymentEmployee" DECIMAL(18,2) NOT NULL,
    "incomeTaxBase" DECIMAL(18,2) NOT NULL,
    "cumulativeTaxBase" DECIMAL(18,2) NOT NULL,
    "incomeTax" DECIMAL(18,2) NOT NULL,
    "incomeTaxExemption" DECIMAL(18,2) NOT NULL,
    "stampTax" DECIMAL(18,2) NOT NULL,
    "stampTaxExemption" DECIMAL(18,2) NOT NULL,
    "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,2) NOT NULL,
    "sgkEmployer" DECIMAL(18,2) NOT NULL,
    "unemploymentEmployer" DECIMAL(18,2) NOT NULL,
    "employerCost" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_items" (
    "id" UUID NOT NULL,
    "payslipId" UUID NOT NULL,
    "kind" "PayslipItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "payslip_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_records_companyId_idx" ON "salary_records"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_records_employeeId_effectiveFrom_key" ON "salary_records"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_parameters_companyId_year_key" ON "payroll_parameters"("companyId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_companyId_number_key" ON "payroll_periods"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_companyId_year_month_key" ON "payroll_periods"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "payslips_employeeId_idx" ON "payslips"("employeeId");

-- CreateIndex
CREATE INDEX "payslips_companyId_idx" ON "payslips"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_periodId_employeeId_key" ON "payslips"("periodId", "employeeId");

-- CreateIndex
CREATE INDEX "payslip_items_payslipId_idx" ON "payslip_items"("payslipId");

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_parameters" ADD CONSTRAINT "payroll_parameters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "treasury_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
