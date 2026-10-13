-- CreateEnum
CREATE TYPE "ContractParty" AS ENUM ('PARTNER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ContractFlow" AS ENUM ('INCOME', 'EXPENSE', 'NONE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ContractBillingCycle" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ContractEventType" AS ENUM ('CREATED', 'UPDATED', 'ACTIVATED', 'RENEWED', 'AUTO_RENEWED', 'TERMINATION_SCHEDULED', 'TERMINATION_CANCELLED', 'TERMINATED', 'EXPIRED', 'REMINDER_SENT');

-- CreateTable
CREATE TABLE "contract_types" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "party" "ContractParty" NOT NULL,
    "flow" "ContractFlow" NOT NULL DEFAULT 'NONE',
    "defaultTermMonths" INTEGER,
    "defaultNoticeDays" INTEGER NOT NULL DEFAULT 30,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "typeId" UUID NOT NULL,
    "party" "ContractParty" NOT NULL,
    "partnerId" UUID,
    "employeeId" UUID,
    "ownerId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "signedDate" DATE,
    "amount" DECIMAL(18,2),
    "currencyCode" TEXT NOT NULL DEFAULT 'TRY',
    "billingCycle" "ContractBillingCycle" NOT NULL DEFAULT 'ONE_TIME',
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "renewalMonths" INTEGER,
    "noticeDays" INTEGER NOT NULL DEFAULT 30,
    "reminderDays" INTEGER NOT NULL DEFAULT 30,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "terminatedOn" DATE,
    "terminationReason" TEXT,
    "remindedFor" DATE,
    "activatedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_events" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "actorId" UUID,
    "type" "ContractEventType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_types_companyId_name_key" ON "contract_types"("companyId", "name");

-- CreateIndex
CREATE INDEX "contracts_companyId_status_endDate_idx" ON "contracts"("companyId", "status", "endDate");

-- CreateIndex
CREATE INDEX "contracts_partnerId_idx" ON "contracts"("partnerId");

-- CreateIndex
CREATE INDEX "contracts_employeeId_idx" ON "contracts"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_companyId_number_key" ON "contracts"("companyId", "number");

-- CreateIndex
CREATE INDEX "contract_events_contractId_createdAt_idx" ON "contract_events"("contractId", "createdAt");

-- AddForeignKey
ALTER TABLE "contract_types" ADD CONSTRAINT "contract_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "contract_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
