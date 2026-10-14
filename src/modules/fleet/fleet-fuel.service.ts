import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VehicleOdometerSource } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import type { Paginated } from '../../common/pagination/pagination.dto';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { CreateFuelEntryDto, FuelEntryDto, FuelEntryQueryDto } from './dto/fleet.dto';
import {
  assertNotFuture,
  assertOdometer,
  fleetToday,
  fullName,
  lockVehicle,
  refreshOdometer,
  trimOrNull,
} from './fleet-helpers';
import { fuelFigures } from './fleet-math';
import { VehiclesService } from './vehicles.service';

const SORTABLE = ['entryDate', 'amount', 'liters', 'odometer'] as const;

const fuelInclude = {
  vehicle: { select: { plate: true } },
  employee: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.VehicleFuelEntryInclude;

type FuelEntryRow = Prisma.VehicleFuelEntryGetPayload<{ include: typeof fuelInclude }>;

const toFuelDto = (row: FuelEntryRow): FuelEntryDto => ({
  id: row.id,
  vehicleId: row.vehicleId,
  plate: row.vehicle.plate,
  entryDate: toDateOnly(row.entryDate),
  odometer: row.odometer,
  liters: row.liters.toFixed(2),
  amount: row.amount.toFixed(2),
  unitPrice: row.liters.isZero() ? '0.00' : row.amount.dividedBy(row.liters).toFixed(2),
  fullTank: row.fullTank,
  station: row.station,
  employeeId: row.employeeId,
  driverName: row.employee ? fullName(row.employee) : null,
  distance: row.distance,
  consumption: row.consumption?.toFixed(2) ?? null,
  note: row.note,
  createdByName: fullName(row.createdBy),
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class FleetFuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
  ) {}

  /** Fleet-wide log; searches plate, station and driver. */
  async list(companyId: string, query: FuelEntryQueryDto): Promise<Paginated<FuelEntryDto>> {
    const search = query.search?.trim();
    const where: Prisma.VehicleFuelEntryWhereInput = {
      companyId,
      vehicleId: query.vehicleId,
      entryDate: {
        gte: query.from ? parseDateOnly(query.from) : undefined,
        lte: query.to ? parseDateOnly(query.to) : undefined,
      },
      ...(search
        ? {
            OR: [
              { vehicle: { plate: { contains: search, mode: 'insensitive' } } },
              { station: { contains: search, mode: 'insensitive' } },
              { employee: { firstName: { contains: search, mode: 'insensitive' } } },
              { employee: { lastName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.vehicleFuelEntry.findMany({
        where,
        include: fuelInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'entryDate'), { odometer: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.vehicleFuelEntry.count({ where }),
    ]);
    return paginated(rows.map(toFuelDto), total, query);
  }

  /** One vehicle's entries in a year, newest first. */
  async forVehicle(user: AuthUser, id: string, year?: number): Promise<FuelEntryDto[]> {
    await this.vehicles.access(user, id);
    const y = year ?? fleetToday().getUTCFullYear();
    const rows = await this.prisma.vehicleFuelEntry.findMany({
      where: {
        vehicleId: id,
        entryDate: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) },
      },
      include: fuelInclude,
      orderBy: [{ entryDate: 'desc' }, { odometer: 'desc' }],
    });
    return rows.map(toFuelDto);
  }

  /** The driver on the day pays at the pump; consumption is recalculated for the vehicle. */
  async create(user: AuthUser, id: string, dto: CreateFuelEntryDto): Promise<FuelEntryDto> {
    const access = await this.vehicles.driverAccess(user, id);
    const date = parseDateOnly(dto.entryDate);
    assertNotFuture(date, fleetToday());
    this.vehicles.assertDriverDate(access, date);
    const entryId = await this.prisma.$transaction(async (tx) => {
      await lockVehicle(tx, user.companyId, id);
      await assertOdometer(tx, id, date, dto.odometer);
      const driver = await tx.vehicleAssignment.findFirst({
        where: {
          vehicleId: id,
          startDate: { lte: date },
          OR: [{ endDate: null }, { endDate: { gte: date } }],
        },
        orderBy: { startDate: 'desc' },
        select: { employeeId: true },
      });
      const entry = await tx.vehicleFuelEntry.create({
        data: {
          companyId: user.companyId,
          vehicleId: id,
          entryDate: date,
          odometer: dto.odometer,
          liters: dto.liters,
          amount: dto.amount,
          fullTank: dto.fullTank ?? true,
          station: trimOrNull(dto.station) ?? null,
          employeeId: driver?.employeeId ?? null,
          note: trimOrNull(dto.note) ?? null,
          createdById: user.id,
        },
      });
      await tx.vehicleOdometerReading.create({
        data: {
          vehicleId: id,
          readingDate: date,
          odometer: dto.odometer,
          source: VehicleOdometerSource.FUEL,
          fuelEntryId: entry.id,
          createdById: user.id,
        },
      });
      await this.recompute(tx, id);
      await refreshOdometer(tx, id);
      return entry.id;
    });
    const row = await this.prisma.vehicleFuelEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: fuelInclude,
    });
    return toFuelDto(row);
  }

  async remove(user: AuthUser, id: string, entryId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockVehicle(tx, user.companyId, id);
      const entry = await tx.vehicleFuelEntry.findFirst({ where: { id: entryId, vehicleId: id } });
      if (!entry) throw new NotFoundException('Fuel entry not found');
      await tx.vehicleFuelEntry.delete({ where: { id: entryId } });
      await this.recompute(tx, id);
      await refreshOdometer(tx, id);
    });
  }

  /** Stores each entry's distance and full-tank consumption. */
  private async recompute(tx: PrismaTx, vehicleId: string) {
    const entries = await tx.vehicleFuelEntry.findMany({
      where: { vehicleId },
      select: {
        id: true,
        entryDate: true,
        odometer: true,
        liters: true,
        fullTank: true,
        distance: true,
        consumption: true,
      },
    });
    const figures = fuelFigures(entries);
    for (const entry of entries) {
      const next = figures.get(entry.id);
      if (!next) continue;
      const same =
        entry.distance === next.distance &&
        (entry.consumption?.toFixed(2) ?? null) === (next.consumption?.toFixed(2) ?? null);
      if (same) continue;
      await tx.vehicleFuelEntry.update({
        where: { id: entry.id },
        data: { distance: next.distance, consumption: next.consumption },
      });
    }
  }
}
