-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'IN_SERVICE', 'RETIRED');

-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('GASOLINE', 'DIESEL', 'LPG', 'HYBRID', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "VehicleOwnership" AS ENUM ('OWNED', 'LEASED', 'RENTED');

-- CreateEnum
CREATE TYPE "VehicleServiceType" AS ENUM ('PERIODIC', 'REPAIR', 'TIRE', 'ACCIDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleDocumentType" AS ENUM ('INSPECTION', 'TRAFFIC_INSURANCE', 'CASCO', 'EMISSION');

-- CreateEnum
CREATE TYPE "VehicleOdometerSource" AS ENUM ('MANUAL', 'FUEL', 'SERVICE', 'ASSIGNMENT');

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelYear" INTEGER,
    "color" TEXT,
    "vin" TEXT,
    "fuelType" "VehicleFuelType" NOT NULL,
    "ownership" "VehicleOwnership" NOT NULL DEFAULT 'OWNED',
    "contractEndsOn" DATE,
    "departmentId" UUID,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "odometer" INTEGER NOT NULL DEFAULT 0,
    "serviceIntervalKm" INTEGER,
    "serviceIntervalMonths" INTEGER,
    "nextServiceKm" INTEGER,
    "nextServiceDate" DATE,
    "serviceRemindedFor" TEXT,
    "notes" TEXT,
    "retiredOn" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_assignments" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "startOdometer" INTEGER NOT NULL,
    "endOdometer" INTEGER,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_odometer_readings" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "readingDate" DATE NOT NULL,
    "odometer" INTEGER NOT NULL,
    "source" "VehicleOdometerSource" NOT NULL,
    "fuelEntryId" UUID,
    "serviceId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_odometer_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_fuel_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "odometer" INTEGER NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "station" TEXT,
    "employeeId" UUID,
    "distance" INTEGER,
    "consumption" DECIMAL(6,2),
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_fuel_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_services" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "VehicleServiceType" NOT NULL,
    "serviceDate" DATE NOT NULL,
    "odometer" INTEGER,
    "partnerId" UUID,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "VehicleDocumentType" NOT NULL,
    "startDate" DATE,
    "endDate" DATE NOT NULL,
    "provider" TEXT,
    "policyNumber" TEXT,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "remindedState" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicles_companyId_status_idx" ON "vehicles"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_companyId_plate_key" ON "vehicles"("companyId", "plate");

-- CreateIndex
CREATE INDEX "vehicle_assignments_vehicleId_startDate_idx" ON "vehicle_assignments"("vehicleId", "startDate");

-- CreateIndex
CREATE INDEX "vehicle_assignments_employeeId_endDate_idx" ON "vehicle_assignments"("employeeId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_odometer_readings_fuelEntryId_key" ON "vehicle_odometer_readings"("fuelEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_odometer_readings_serviceId_key" ON "vehicle_odometer_readings"("serviceId");

-- CreateIndex
CREATE INDEX "vehicle_odometer_readings_vehicleId_readingDate_idx" ON "vehicle_odometer_readings"("vehicleId", "readingDate");

-- CreateIndex
CREATE INDEX "vehicle_fuel_entries_companyId_entryDate_idx" ON "vehicle_fuel_entries"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "vehicle_fuel_entries_vehicleId_entryDate_idx" ON "vehicle_fuel_entries"("vehicleId", "entryDate");

-- CreateIndex
CREATE INDEX "vehicle_services_companyId_serviceDate_idx" ON "vehicle_services"("companyId", "serviceDate");

-- CreateIndex
CREATE INDEX "vehicle_services_vehicleId_serviceDate_idx" ON "vehicle_services"("vehicleId", "serviceDate");

-- CreateIndex
CREATE INDEX "vehicle_documents_companyId_endDate_idx" ON "vehicle_documents"("companyId", "endDate");

-- CreateIndex
CREATE INDEX "vehicle_documents_vehicleId_type_endDate_idx" ON "vehicle_documents"("vehicleId", "type", "endDate");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_odometer_readings" ADD CONSTRAINT "vehicle_odometer_readings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_odometer_readings" ADD CONSTRAINT "vehicle_odometer_readings_fuelEntryId_fkey" FOREIGN KEY ("fuelEntryId") REFERENCES "vehicle_fuel_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_odometer_readings" ADD CONSTRAINT "vehicle_odometer_readings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "vehicle_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_odometer_readings" ADD CONSTRAINT "vehicle_odometer_readings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fuel_entries" ADD CONSTRAINT "vehicle_fuel_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fuel_entries" ADD CONSTRAINT "vehicle_fuel_entries_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fuel_entries" ADD CONSTRAINT "vehicle_fuel_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fuel_entries" ADD CONSTRAINT "vehicle_fuel_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_services" ADD CONSTRAINT "vehicle_services_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_services" ADD CONSTRAINT "vehicle_services_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_services" ADD CONSTRAINT "vehicle_services_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_services" ADD CONSTRAINT "vehicle_services_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

