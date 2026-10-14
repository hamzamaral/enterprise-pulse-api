import { Injectable } from '@nestjs/common';
import { Prisma, VehicleDocumentType, VehicleStatus } from '@prisma/client';
import { toDateOnly } from '../../common/dates/date-only';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  FleetAlertDto,
  FleetAlertState,
  FleetMonthDto,
  FleetRunResultDto,
  FleetSummaryDto,
} from './dto/fleet.dto';
import {
  documentCostDate,
  documentStatuses,
  FLEET_UPDATE,
  fleetToday,
  vehicleInclude,
  yearFacts,
  type VehicleRow,
} from './fleet-helpers';
import {
  costPerKm,
  daysBetween,
  documentState,
  monthlyKm,
  REQUIRED_DOCUMENTS,
  serviceState,
  WARN_DAYS,
} from './fleet-math';

const ZERO = new Prisma.Decimal(0);

const DOCUMENT_LABELS: Record<VehicleDocumentType, string> = {
  INSPECTION: 'Muayene',
  TRAFFIC_INSURANCE: 'Trafik sigortası',
  CASCO: 'Kasko',
  EMISSION: 'Egzoz emisyon',
};

const SEVERE: FleetAlertState[] = ['EXPIRED', 'OVERDUE', 'MISSING'];

/** dd.MM.yyyy for notification texts. */
const trDate = (date: Date) => toDateOnly(date).split('-').reverse().join('.');
const trKm = (km: number) => `${km.toLocaleString('tr-TR')} km`;

const monthKey = (date: Date) => toDateOnly(date).slice(0, 7);

@Injectable()
export class FleetSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async summary(companyId: string): Promise<FleetSummaryDto> {
    const today = fleetToday();
    const year = today.getUTCFullYear();
    const from = new Date(Date.UTC(year, today.getUTCMonth() - 11, 1));
    const [company, rows, fuel, services] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { baseCurrency: true },
      }),
      this.prisma.vehicle.findMany({
        where: { companyId },
        include: vehicleInclude,
        orderBy: { plate: 'asc' },
      }),
      this.prisma.vehicleFuelEntry.findMany({
        where: { companyId, entryDate: { gte: from } },
        select: { entryDate: true, liters: true, amount: true },
      }),
      this.prisma.vehicleService.findMany({
        where: { companyId, serviceDate: { gte: from } },
        select: { serviceDate: true, cost: true },
      }),
    ]);
    const readings = await this.prisma.vehicleOdometerReading.findMany({
      where: { vehicleId: { in: rows.map((r) => r.id) } },
      select: { vehicleId: true, readingDate: true, odometer: true },
    });
    const facts = await yearFacts(this.prisma, rows, year);
    const onRoad = rows.filter((r) => r.status !== VehicleStatus.RETIRED);

    const yearCost = [...facts.values()].reduce((sum, f) => sum.plus(f.cost), ZERO);
    const yearKm = rows.reduce(
      (sum, row) =>
        sum +
        monthlyKm(
          readings.filter((r) => r.vehicleId === row.id),
          year,
        ).reduce((a, b) => a + b, 0),
      0,
    );
    const consumptions = [...facts.values()]
      .map((f) => f.consumption)
      .filter((c): c is Prisma.Decimal => c !== null);

    const months: FleetMonthDto[] = Array.from({ length: 12 }, (_, i) => {
      const key = monthKey(new Date(Date.UTC(year, today.getUTCMonth() - 11 + i, 1)));
      const entries = fuel.filter((f) => monthKey(f.entryDate) === key);
      return {
        month: key,
        fuelCost: entries.reduce((sum, f) => sum.plus(f.amount), ZERO).toFixed(2),
        liters: entries.reduce((sum, f) => sum.plus(f.liters), ZERO).toFixed(2),
        serviceCost: services
          .filter((s) => monthKey(s.serviceDate) === key)
          .reduce((sum, s) => sum.plus(s.cost), ZERO)
          .toFixed(2),
        documentCost: rows
          .flatMap((r) => r.documents)
          .filter((d) => monthKey(documentCostDate(d)) === key)
          .reduce((sum, d) => sum.plus(d.cost), ZERO)
          .toFixed(2),
      };
    });
    const yearFuelCost = fuel
      .filter((f) => f.entryDate.getUTCFullYear() === year)
      .reduce((sum, f) => sum.plus(f.amount), ZERO);

    return {
      currencyCode: company.baseCurrency,
      total: onRoad.length,
      active: onRoad.filter((r) => r.status === VehicleStatus.ACTIVE).length,
      inService: onRoad.filter((r) => r.status === VehicleStatus.IN_SERVICE).length,
      assigned: onRoad.filter((r) => r.assignments.length > 0).length,
      unassigned: onRoad.filter((r) => r.assignments.length === 0).length,
      yearCost: yearCost.toFixed(2),
      yearFuelCost: yearFuelCost.toFixed(2),
      yearKm,
      costPerKm: costPerKm(yearCost, yearKm)?.toFixed(2) ?? null,
      consumption: consumptions.length
        ? consumptions
            .reduce((sum, c) => sum.plus(c), ZERO)
            .dividedBy(consumptions.length)
            .toFixed(2)
        : null,
      alerts: this.alerts(onRoad, today),
      months,
    };
  }

  /**
   * The daily job for one company: reminds fleet managers and the driver once per state of an
   * expiring document and of a due service.
   */
  async run(companyId: string, today = fleetToday()): Promise<FleetRunResultDto> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { companyId, status: { not: VehicleStatus.RETIRED } },
      include: {
        documents: { orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }] },
        assignments: {
          where: { endDate: null },
          select: { employee: { select: { userId: true } } },
          take: 1,
        },
      },
    });
    const managers = await this.notifications.findUserIdsWithPermission(companyId, FLEET_UPDATE);
    let reminders = 0;
    for (const vehicle of vehicles) {
      const driver = vehicle.assignments[0]?.employee.userId;
      const userIds = [...new Set([...managers, ...(driver ? [driver] : [])])];
      const remind = async (title: string, body: string) => {
        reminders += 1;
        if (!userIds.length) return;
        await this.notifications.notify({
          companyId,
          userIds,
          type: 'fleet.vehicle',
          title,
          body,
          link: `/fleet/${vehicle.id}`,
          sendEmail: true,
        });
      };

      for (const type of Object.values(VehicleDocumentType)) {
        const doc = vehicle.documents.find((d) => d.type === type);
        if (!doc) continue;
        const state = documentState(doc.endDate, today);
        if ((state !== 'EXPIRING' && state !== 'EXPIRED') || doc.remindedState === state) continue;
        const label = DOCUMENT_LABELS[type];
        const days = daysBetween(today, doc.endDate);
        await remind(
          state === 'EXPIRED'
            ? `Araç belgesinin süresi doldu: ${vehicle.plate} · ${label}`
            : `Araç belgesinin süresi yaklaşıyor: ${vehicle.plate} · ${label}`,
          state === 'EXPIRED'
            ? `Bitiş: ${trDate(doc.endDate)}`
            : `Bitiş: ${trDate(doc.endDate)} (${days} gün kaldı)`,
        );
        await this.prisma.vehicleDocument.update({
          where: { id: doc.id },
          data: { remindedState: state },
        });
      }

      const service = serviceState(vehicle, today);
      if (service === 'DUE_SOON' || service === 'OVERDUE') {
        const key = `${service}:${vehicle.nextServiceKm ?? ''}:${toDateOnly(vehicle.nextServiceDate) ?? ''}`;
        if (vehicle.serviceRemindedFor !== key) {
          const parts = [
            vehicle.nextServiceKm !== null ? trKm(vehicle.nextServiceKm) : null,
            vehicle.nextServiceDate ? trDate(vehicle.nextServiceDate) : null,
          ].filter(Boolean);
          await remind(
            service === 'OVERDUE'
              ? `Araç bakımı gecikti: ${vehicle.plate}`
              : `Araç bakımı yaklaştı: ${vehicle.plate}`,
            `Sonraki bakım: ${parts.join(' · ')} — şu an ${trKm(vehicle.odometer)}`,
          );
          await this.prisma.vehicle.update({
            where: { id: vehicle.id },
            data: { serviceRemindedFor: key },
          });
        }
      }
    }
    return { vehicles: vehicles.length, reminders };
  }

  /** Runs the daily job for every company with vehicles on the road. */
  async runAll(): Promise<void> {
    const companies = await this.prisma.vehicle.findMany({
      where: { status: { not: VehicleStatus.RETIRED } },
      distinct: ['companyId'],
      select: { companyId: true },
    });
    for (const { companyId } of companies) await this.run(companyId);
  }

  private alerts(rows: VehicleRow[], today: Date): FleetAlertDto[] {
    const alerts: FleetAlertDto[] = [];
    for (const row of rows) {
      const base = { vehicleId: row.id, plate: row.plate };
      for (const doc of documentStatuses(row.documents, today)) {
        const required = (REQUIRED_DOCUMENTS as readonly string[]).includes(doc.type);
        if (doc.state === 'VALID' || (doc.state === 'MISSING' && !required)) continue;
        alerts.push({
          ...base,
          kind: doc.type,
          state: doc.state,
          date: doc.endDate,
          daysLeft: doc.daysLeft,
          kmLeft: null,
        });
      }
      const service = serviceState(row, today);
      if (service === 'DUE_SOON' || service === 'OVERDUE') {
        alerts.push({
          ...base,
          kind: 'SERVICE',
          state: service,
          date: toDateOnly(row.nextServiceDate),
          daysLeft: row.nextServiceDate ? daysBetween(today, row.nextServiceDate) : null,
          kmLeft: row.nextServiceKm !== null ? row.nextServiceKm - row.odometer : null,
        });
      }
      if (row.contractEndsOn) {
        const days = daysBetween(today, row.contractEndsOn);
        if (days <= WARN_DAYS) {
          alerts.push({
            ...base,
            kind: 'CONTRACT',
            state: days < 0 ? 'EXPIRED' : 'EXPIRING',
            date: toDateOnly(row.contractEndsOn),
            daysLeft: days,
            kmLeft: null,
          });
        }
      }
    }
    const rank = (a: FleetAlertDto) => (SEVERE.includes(a.state) ? 0 : 1);
    return alerts.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER) ||
        a.plate.localeCompare(b.plate),
    );
  }
}
