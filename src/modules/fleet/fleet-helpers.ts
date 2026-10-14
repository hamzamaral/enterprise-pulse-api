import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, VehicleDocumentType, VehicleStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import type { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { VehicleDocumentStatusDto, VehicleDto } from './dto/fleet.dto';
import {
  averageConsumption,
  daysBetween,
  documentState,
  odometerRange,
  REQUIRED_DOCUMENTS,
  serviceState,
  WARN_DAYS,
} from './fleet-math';

export const FLEET_READ = 'fleet:read';
export const FLEET_UPDATE = 'fleet:update';

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

export const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/** Today in Istanbul as a `@db.Date` value. */
export const fleetToday = () =>
  parseDateOnly(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }));

export const canManage = (user: AuthUser) => hasPermission(user, FLEET_UPDATE);
export const canRead = (user: AuthUser) => hasPermission(user, FLEET_READ) || canManage(user);

const ZERO = new Prisma.Decimal(0);
const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lt: new Date(Date.UTC(year + 1, 0, 1)),
});

export const vehicleInclude = {
  department: { select: { name: true } },
  assignments: {
    where: { endDate: null },
    include: { employee: { select: { firstName: true, lastName: true, userId: true } } },
    take: 1,
  },
  documents: { select: { type: true, startDate: true, endDate: true, cost: true } },
} satisfies Prisma.VehicleInclude;

export type VehicleRow = Prisma.VehicleGetPayload<{ include: typeof vehicleInclude }>;

/** The driver's user id of the open assignment, if any. */
export const driverUserId = (row: VehicleRow) => row.assignments[0]?.employee.userId ?? null;

/** Cost date of a document: its start, otherwise its end. */
export const documentCostDate = (d: { startDate: Date | null; endDate: Date }) =>
  d.startDate ?? d.endDate;

export function documentStatuses(
  docs: { type: VehicleDocumentType; endDate: Date }[],
  today: Date,
): VehicleDocumentStatusDto[] {
  return Object.values(VehicleDocumentType).map((type) => {
    const latest = docs
      .filter((d) => d.type === type)
      .reduce<Date | null>((max, d) => (!max || d.endDate > max ? d.endDate : max), null);
    return {
      type,
      state: documentState(latest, today),
      endDate: toDateOnly(latest),
      daysLeft: latest ? daysBetween(today, latest) : null,
    };
  });
}

const isRequired = (type: VehicleDocumentType) =>
  (REQUIRED_DOCUMENTS as readonly string[]).includes(type);

/** Alerts and warnings of a vehicle on the road; retired vehicles have none. */
export function attentionCounts(row: VehicleRow, today: Date) {
  if (row.status === VehicleStatus.RETIRED) return { alertCount: 0, warningCount: 0 };
  let alertCount = 0;
  let warningCount = 0;
  for (const doc of documentStatuses(row.documents, today)) {
    if (doc.state === 'EXPIRED' || (doc.state === 'MISSING' && isRequired(doc.type))) alertCount++;
    if (doc.state === 'EXPIRING') warningCount++;
  }
  const service = serviceState(row, today);
  if (service === 'OVERDUE') alertCount++;
  if (service === 'DUE_SOON') warningCount++;
  if (row.contractEndsOn) {
    const days = daysBetween(today, row.contractEndsOn);
    if (days < 0) alertCount++;
    else if (days <= WARN_DAYS) warningCount++;
  }
  return { alertCount, warningCount };
}

export interface YearFacts {
  cost: Prisma.Decimal;
  consumption: Prisma.Decimal | null;
}

/** This year's cost and consumption of each vehicle. */
export async function yearFacts(
  prisma: PrismaService,
  rows: VehicleRow[],
  year: number,
): Promise<Map<string, YearFacts>> {
  const ids = rows.map((r) => r.id);
  const range = yearRange(year);
  const [fuel, services] = await Promise.all([
    prisma.vehicleFuelEntry.findMany({
      where: { vehicleId: { in: ids }, entryDate: range },
      select: {
        id: true,
        vehicleId: true,
        entryDate: true,
        odometer: true,
        liters: true,
        fullTank: true,
        amount: true,
      },
    }),
    prisma.vehicleService.groupBy({
      by: ['vehicleId'],
      where: { vehicleId: { in: ids }, serviceDate: range },
      _sum: { cost: true },
    }),
  ]);
  const serviceCost = new Map(services.map((s) => [s.vehicleId, s._sum.cost ?? ZERO]));
  return new Map(
    rows.map((row) => {
      const entries = fuel.filter((f) => f.vehicleId === row.id);
      const documents = row.documents
        .filter((d) => documentCostDate(d).getUTCFullYear() === year)
        .reduce((sum, d) => sum.plus(d.cost), ZERO);
      const cost = entries
        .reduce((sum, f) => sum.plus(f.amount), ZERO)
        .plus(serviceCost.get(row.id) ?? ZERO)
        .plus(documents);
      return [row.id, { cost, consumption: averageConsumption(entries) }];
    }),
  );
}

export function toVehicleDto(
  row: VehicleRow,
  facts: YearFacts | undefined,
  today: Date,
): VehicleDto {
  const open = row.assignments[0];
  return {
    id: row.id,
    plate: row.plate,
    brand: row.brand,
    model: row.model,
    modelYear: row.modelYear,
    color: row.color,
    vin: row.vin,
    fuelType: row.fuelType,
    ownership: row.ownership,
    contractEndsOn: toDateOnly(row.contractEndsOn),
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    status: row.status,
    odometer: row.odometer,
    serviceIntervalKm: row.serviceIntervalKm,
    serviceIntervalMonths: row.serviceIntervalMonths,
    nextServiceKm: row.nextServiceKm,
    nextServiceDate: toDateOnly(row.nextServiceDate),
    serviceState: row.status === VehicleStatus.RETIRED ? null : serviceState(row, today),
    driver: open
      ? {
          assignmentId: open.id,
          employeeId: open.employeeId,
          name: fullName(open.employee),
          since: toDateOnly(open.startDate),
        }
      : null,
    documents: documentStatuses(row.documents, today),
    ...attentionCounts(row, today),
    yearCost: (facts?.cost ?? ZERO).toFixed(2),
    consumption: facts?.consumption?.toFixed(2) ?? null,
    retiredOn: toDateOnly(row.retiredOn),
  };
}

/** Serialises changes to one vehicle: assignments, readings and fuel figures. */
export async function lockVehicle(tx: PrismaTx, companyId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${id}::uuid FOR UPDATE`;
  const vehicle = await tx.vehicle.findFirst({ where: { id, companyId } });
  if (!vehicle) throw new NotFoundException('Vehicle not found');
  return vehicle;
}

export function assertNotFuture(date: Date, today: Date) {
  if (date > today) throw new BadRequestException('Date cannot be in the future');
}

/** Rejects an odometer value that breaks the order of the vehicle's readings. */
export async function assertOdometer(tx: PrismaTx, vehicleId: string, date: Date, km: number) {
  const readings = await tx.vehicleOdometerReading.findMany({
    where: { vehicleId },
    select: { readingDate: true, odometer: true },
  });
  const { min, max } = odometerRange(readings, date);
  if (km < min) {
    throw new BadRequestException(`Odometer cannot be lower than ${min} km recorded by that date`);
  }
  if (max !== null && km > max) {
    throw new BadRequestException(`Odometer cannot be higher than ${max} km recorded later`);
  }
}

/** Sets the vehicle's odometer to its highest reading. */
export async function refreshOdometer(tx: PrismaTx, vehicleId: string) {
  const { _max } = await tx.vehicleOdometerReading.aggregate({
    where: { vehicleId },
    _max: { odometer: true },
  });
  if (_max.odometer === null) return;
  await tx.vehicle.update({ where: { id: vehicleId }, data: { odometer: _max.odometer } });
}
