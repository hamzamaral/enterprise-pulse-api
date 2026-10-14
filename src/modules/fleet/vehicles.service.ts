import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  Prisma,
  VehicleOdometerSource,
  VehicleOwnership,
  VehicleServiceType,
  VehicleStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AssignVehicleDto,
  CreateReadingDto,
  CreateVehicleDocumentDto,
  CreateVehicleDto,
  CreateVehicleServiceDto,
  FleetOptionsDto,
  ReturnVehicleDto,
  UpdateVehicleDto,
  VehicleDetailDto,
  VehicleDocumentDto,
  VehicleDto,
  VehicleQueryDto,
  VehicleYearStatsDto,
} from './dto/fleet.dto';
import {
  assertNotFuture,
  assertOdometer,
  canManage,
  canRead,
  documentCostDate,
  driverUserId,
  fleetToday,
  fullName,
  lockVehicle,
  refreshOdometer,
  toVehicleDto,
  trimOrNull,
  vehicleInclude,
  yearFacts,
  type VehicleRow,
} from './fleet-helpers';
import {
  averageConsumption,
  costPerKm,
  monthlyKm,
  nextService,
  normalizePlate,
  odometerRange,
} from './fleet-math';

const ZERO = new Prisma.Decimal(0);

/** dd.MM.yyyy for notification texts. */
const trDate = (date: Date) => toDateOnly(date).split('-').reverse().join('.');

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export interface VehicleAccess {
  row: VehicleRow;
  canManage: boolean;
  isDriver: boolean;
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthUser, query: VehicleQueryDto): Promise<VehicleDto[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { companyId: user.companyId, status: query.status },
      include: vehicleInclude,
      orderBy: { plate: 'asc' },
    });
    return this.toDtos(rows);
  }

  /** Vehicles the user currently drives. */
  async my(user: AuthUser): Promise<VehicleDto[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: {
        companyId: user.companyId,
        assignments: { some: { endDate: null, employee: { userId: user.id } } },
      },
      include: vehicleInclude,
      orderBy: { plate: 'asc' },
    });
    return this.toDtos(rows);
  }

  async options(companyId: string): Promise<FleetOptionsDto> {
    const [employees, departments, partners] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
          vehicleAssignments: {
            where: { endDate: null },
            select: { vehicle: { select: { plate: true } } },
            take: 1,
          },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.department.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.businessPartner.findMany({
        where: { companyId, deletedAt: null, isActive: true, type: { in: ['SUPPLIER', 'BOTH'] } },
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      }),
    ]);
    return {
      drivers: employees.map((e) => ({
        id: e.id,
        name: fullName(e),
        departmentName: e.department?.name ?? null,
        currentPlate: e.vehicleAssignments[0]?.vehicle.plate ?? null,
      })),
      departments,
      partners: partners.map((p) => ({ id: p.id, name: p.title })),
    };
  }

  /** 404 unless the user reads the fleet or drives the vehicle. */
  async access(user: AuthUser, id: string): Promise<VehicleAccess> {
    const row = await this.prisma.vehicle.findFirst({
      where: { id, companyId: user.companyId },
      include: vehicleInclude,
    });
    if (!row) throw new NotFoundException('Vehicle not found');
    const isDriver = driverUserId(row) === user.id;
    if (!canRead(user) && !isDriver) throw new NotFoundException('Vehicle not found');
    return { row, canManage: canManage(user), isDriver };
  }

  /** Managers and the current driver may add fuel and readings to a vehicle on the road. */
  async driverAccess(user: AuthUser, id: string): Promise<VehicleAccess> {
    const access = await this.access(user, id);
    if (!access.canManage && !access.isDriver) {
      throw new ForbiddenException('Only fleet managers and the driver can record this');
    }
    if (access.row.status === VehicleStatus.RETIRED) {
      throw new ConflictException('The vehicle is retired');
    }
    return access;
  }

  /** A driver may only record days since the vehicle was handed over to them. */
  assertDriverDate(access: VehicleAccess, date: Date) {
    if (access.canManage) return;
    const since = access.row.assignments[0]?.startDate;
    if (since && date < since) {
      throw new BadRequestException('Date cannot be before the vehicle was handed over to you');
    }
  }

  async findOne(user: AuthUser, id: string, year?: number): Promise<VehicleDetailDto> {
    const access = await this.access(user, id);
    const { row } = access;
    const today = fleetToday();
    const statsYear = year ?? today.getUTCFullYear();
    const [facts, company, creator, assignments, readings, services, documents, fuelCount] =
      await Promise.all([
        yearFacts(this.prisma, [row], today.getUTCFullYear()),
        this.prisma.company.findUniqueOrThrow({
          where: { id: user.companyId },
          select: { baseCurrency: true },
        }),
        this.prisma.user.findUnique({
          where: { id: row.createdById },
          select: { firstName: true, lastName: true },
        }),
        this.prisma.vehicleAssignment.findMany({
          where: { vehicleId: id },
          include: {
            employee: {
              select: { firstName: true, lastName: true, department: { select: { name: true } } },
            },
            createdBy: { select: { firstName: true, lastName: true } },
          },
          orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        }),
        this.prisma.vehicleOdometerReading.findMany({
          where: { vehicleId: id },
          include: { createdBy: { select: { firstName: true, lastName: true } } },
          orderBy: [{ readingDate: 'desc' }, { odometer: 'desc' }],
        }),
        this.prisma.vehicleService.findMany({
          where: { vehicleId: id },
          include: {
            partner: { select: { title: true } },
            createdBy: { select: { firstName: true, lastName: true } },
          },
          orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
        }),
        this.prisma.vehicleDocument.findMany({
          where: { vehicleId: id },
          include: { createdBy: { select: { firstName: true, lastName: true } } },
          orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
        }),
        this.prisma.vehicleFuelEntry.count({ where: { vehicleId: id } }),
      ]);
    const current = new Set<string>();
    const seen = new Set<string>();
    for (const doc of documents) {
      if (seen.has(doc.type)) continue;
      seen.add(doc.type);
      current.add(doc.id);
    }
    const hasHistory = assignments.length + services.length + documents.length + fuelCount > 0;
    return {
      ...toVehicleDto(row, facts.get(row.id), today),
      currencyCode: company.baseCurrency,
      notes: row.notes,
      createdByName: creator ? fullName(creator) : '',
      createdAt: row.createdAt.toISOString(),
      assignments: assignments.map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        employeeName: fullName(a.employee),
        departmentName: a.employee.department?.name ?? null,
        startDate: toDateOnly(a.startDate),
        endDate: toDateOnly(a.endDate),
        startOdometer: a.startOdometer,
        endOdometer: a.endOdometer,
        note: a.note,
        createdByName: fullName(a.createdBy),
      })),
      readings: readings.map((r) => ({
        id: r.id,
        readingDate: toDateOnly(r.readingDate),
        odometer: r.odometer,
        source: r.source,
        note: r.note,
        createdByName: r.createdBy ? fullName(r.createdBy) : null,
      })),
      services: services.map((s) => ({
        id: s.id,
        type: s.type,
        serviceDate: toDateOnly(s.serviceDate),
        odometer: s.odometer,
        partnerId: s.partnerId,
        partnerName: s.partner?.title ?? null,
        description: s.description,
        cost: s.cost.toFixed(2),
        createdByName: fullName(s.createdBy),
      })),
      allDocuments: documents.map((d): VehicleDocumentDto => ({
        id: d.id,
        type: d.type,
        startDate: toDateOnly(d.startDate),
        endDate: toDateOnly(d.endDate),
        provider: d.provider,
        policyNumber: d.policyNumber,
        cost: d.cost.toFixed(2),
        note: d.note,
        isCurrent: current.has(d.id),
        createdByName: fullName(d.createdBy),
      })),
      stats: await this.stats(id, statsYear, readings),
      canManage: access.canManage,
      isDriver: access.isDriver,
      canDelete: access.canManage && !hasHistory,
    };
  }

  async create(user: AuthUser, dto: CreateVehicleDto): Promise<VehicleDetailDto> {
    const companyId = user.companyId;
    const plate = toPlate(dto.plate);
    await this.assertDepartment(companyId, dto.departmentId);
    const today = fleetToday();
    const odometer = dto.odometer ?? 0;
    const ownership = dto.ownership ?? VehicleOwnership.OWNED;
    const schedule = nextService(
      today,
      odometer,
      dto.serviceIntervalKm ?? null,
      dto.serviceIntervalMonths ?? null,
    );
    try {
      const vehicle = await this.prisma.$transaction(async (tx) => {
        const created = await tx.vehicle.create({
          data: {
            companyId,
            plate,
            brand: dto.brand.trim(),
            model: dto.model.trim(),
            modelYear: dto.modelYear ?? null,
            color: trimOrNull(dto.color) ?? null,
            vin: trimOrNull(dto.vin)?.toUpperCase() ?? null,
            fuelType: dto.fuelType,
            ownership,
            contractEndsOn:
              ownership !== VehicleOwnership.OWNED && dto.contractEndsOn
                ? parseDateOnly(dto.contractEndsOn)
                : null,
            departmentId: dto.departmentId ?? null,
            odometer,
            serviceIntervalKm: dto.serviceIntervalKm ?? null,
            serviceIntervalMonths: dto.serviceIntervalMonths ?? null,
            nextServiceKm:
              dto.nextServiceKm !== undefined ? dto.nextServiceKm : schedule.nextServiceKm,
            nextServiceDate:
              dto.nextServiceDate !== undefined
                ? dto.nextServiceDate
                  ? parseDateOnly(dto.nextServiceDate)
                  : null
                : schedule.nextServiceDate,
            notes: trimOrNull(dto.notes) ?? null,
            createdById: user.id,
          },
        });
        if (odometer > 0) {
          await tx.vehicleOdometerReading.create({
            data: {
              vehicleId: created.id,
              readingDate: today,
              odometer,
              source: VehicleOdometerSource.MANUAL,
              createdById: user.id,
            },
          });
        }
        return created;
      });
      return this.findOne(user, vehicle.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A vehicle with this plate already exists');
      }
      throw error;
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateVehicleDto): Promise<VehicleDetailDto> {
    const companyId = user.companyId;
    const plate = dto.plate !== undefined ? toPlate(dto.plate) : undefined;
    if (dto.departmentId) await this.assertDepartment(companyId, dto.departmentId);
    const today = fleetToday();
    try {
      await this.prisma.$transaction(async (tx) => {
        const vehicle = await lockVehicle(tx, companyId, id);
        const ownership = dto.ownership ?? vehicle.ownership;
        const status = dto.status ?? vehicle.status;
        const retiring =
          status === VehicleStatus.RETIRED && vehicle.status !== VehicleStatus.RETIRED;
        const scheduleChanged =
          dto.nextServiceKm !== undefined || dto.nextServiceDate !== undefined;
        if (retiring) await this.closeOpenAssignment(tx, vehicle, today);
        await tx.vehicle.update({
          where: { id },
          data: {
            plate,
            brand: dto.brand?.trim(),
            model: dto.model?.trim(),
            modelYear: dto.modelYear,
            color: trimOrNull(dto.color),
            vin: trimOrNull(dto.vin)?.toUpperCase() ?? (dto.vin === undefined ? undefined : null),
            fuelType: dto.fuelType,
            ownership: dto.ownership,
            contractEndsOn:
              ownership === VehicleOwnership.OWNED
                ? null
                : dto.contractEndsOn === undefined
                  ? undefined
                  : dto.contractEndsOn
                    ? parseDateOnly(dto.contractEndsOn)
                    : null,
            departmentId: dto.departmentId,
            serviceIntervalKm: dto.serviceIntervalKm,
            serviceIntervalMonths: dto.serviceIntervalMonths,
            nextServiceKm: dto.nextServiceKm,
            nextServiceDate:
              dto.nextServiceDate === undefined
                ? undefined
                : dto.nextServiceDate
                  ? parseDateOnly(dto.nextServiceDate)
                  : null,
            serviceRemindedFor: scheduleChanged ? null : undefined,
            notes: trimOrNull(dto.notes),
            status: dto.status,
            retiredOn: retiring ? today : status === VehicleStatus.RETIRED ? undefined : null,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A vehicle with this plate already exists');
      }
      throw error;
    }
    return this.findOne(user, id);
  }

  /** Only vehicles without any history can be deleted; the others are retired. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.prisma.vehicle.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        _count: {
          select: { assignments: true, fuelEntries: true, services: true, documents: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Vehicle not found');
    const { assignments, fuelEntries, services, documents } = row._count;
    if (assignments + fuelEntries + services + documents > 0) {
      throw new ConflictException('Vehicles with history cannot be deleted; retire them instead');
    }
    await this.prisma.vehicle.delete({ where: { id } });
  }

  /** Hands the vehicle over; an open assignment is closed on the same day. */
  async assign(user: AuthUser, id: string, dto: AssignVehicleDto): Promise<VehicleDetailDto> {
    const companyId = user.companyId;
    const start = parseDateOnly(dto.startDate);
    assertNotFuture(start, fleetToday());
    const { vehicle, employee } = await this.prisma.$transaction(async (tx) => {
      const vehicle = await lockVehicle(tx, companyId, id);
      if (vehicle.status === VehicleStatus.RETIRED) {
        throw new ConflictException('Retired vehicles cannot be assigned');
      }
      const employee = await tx.employee.findFirst({
        where: { id: dto.employeeId, companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
        select: { firstName: true, lastName: true, userId: true },
      });
      if (!employee) throw new BadRequestException('Employee not found or not active');
      const last = await tx.vehicleAssignment.findFirst({
        where: { vehicleId: id },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      });
      if (last && last.endDate === null) {
        if (last.employeeId === dto.employeeId) {
          throw new ConflictException('The vehicle is already assigned to this employee');
        }
        if (start < last.startDate) {
          throw new BadRequestException('Handover cannot be before the current assignment started');
        }
      } else if (last?.endDate && start < last.endDate) {
        throw new BadRequestException('Assignment cannot start before the previous one ended');
      }
      const km = await this.odometerAt(tx, vehicle, start, dto.odometer);
      if (last && last.endDate === null) {
        await tx.vehicleAssignment.update({
          where: { id: last.id },
          data: { endDate: start, endOdometer: Math.max(km, last.startOdometer) },
        });
      }
      await tx.vehicleAssignment.create({
        data: {
          vehicleId: id,
          employeeId: dto.employeeId,
          startDate: start,
          startOdometer: km,
          note: trimOrNull(dto.note) ?? null,
          createdById: user.id,
        },
      });
      if (dto.odometer !== undefined) {
        await this.writeReading(tx, id, start, km, VehicleOdometerSource.ASSIGNMENT, user.id);
      }
      return { vehicle, employee };
    });
    if (employee.userId && employee.userId !== user.id) {
      await this.notifications.notify({
        companyId,
        userIds: [employee.userId],
        type: 'fleet.vehicle',
        title: `Size araç zimmetlendi: ${vehicle.plate}`,
        body: `${vehicle.brand} ${vehicle.model} · ${trDate(start)}`,
        link: `/fleet/${id}`,
      });
    }
    return this.findOne(user, id);
  }

  /** Takes the vehicle back from its driver. */
  async returnVehicle(
    user: AuthUser,
    id: string,
    dto: ReturnVehicleDto,
  ): Promise<VehicleDetailDto> {
    const end = parseDateOnly(dto.endDate);
    assertNotFuture(end, fleetToday());
    await this.prisma.$transaction(async (tx) => {
      const vehicle = await lockVehicle(tx, user.companyId, id);
      const open = await tx.vehicleAssignment.findFirst({
        where: { vehicleId: id, endDate: null },
      });
      if (!open) throw new ConflictException('The vehicle has no driver');
      if (end < open.startDate) {
        throw new BadRequestException('Return cannot be before the assignment started');
      }
      const known = await this.odometerAt(tx, vehicle, end, dto.odometer);
      const km = dto.odometer === undefined ? Math.max(known, open.startOdometer) : known;
      if (km < open.startOdometer) {
        throw new BadRequestException('Return odometer cannot be lower than at handover');
      }
      const note = trimOrNull(dto.note);
      await tx.vehicleAssignment.update({
        where: { id: open.id },
        data: {
          endDate: end,
          endOdometer: km,
          note: note ? [open.note, note].filter(Boolean).join('\n') : undefined,
        },
      });
      if (dto.odometer !== undefined) {
        await this.writeReading(tx, id, end, km, VehicleOdometerSource.ASSIGNMENT, user.id);
      }
    });
    return this.findOne(user, id);
  }

  async addReading(user: AuthUser, id: string, dto: CreateReadingDto): Promise<VehicleDetailDto> {
    const access = await this.driverAccess(user, id);
    const date = parseDateOnly(dto.readingDate);
    assertNotFuture(date, fleetToday());
    this.assertDriverDate(access, date);
    await this.prisma.$transaction(async (tx) => {
      await lockVehicle(tx, user.companyId, id);
      await assertOdometer(tx, id, date, dto.odometer);
      await tx.vehicleOdometerReading.create({
        data: {
          vehicleId: id,
          readingDate: date,
          odometer: dto.odometer,
          source: VehicleOdometerSource.MANUAL,
          note: trimOrNull(dto.note) ?? null,
          createdById: user.id,
        },
      });
      await refreshOdometer(tx, id);
    });
    return this.findOne(user, id);
  }

  /** Readings from fuel entries, services and handovers go with their record. */
  async removeReading(user: AuthUser, id: string, readingId: string): Promise<VehicleDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockVehicle(tx, user.companyId, id);
      const reading = await tx.vehicleOdometerReading.findFirst({
        where: { id: readingId, vehicleId: id },
      });
      if (!reading) throw new NotFoundException('Reading not found');
      if (reading.source !== VehicleOdometerSource.MANUAL) {
        throw new ConflictException('Only manual readings can be deleted');
      }
      await tx.vehicleOdometerReading.delete({ where: { id: readingId } });
      await refreshOdometer(tx, id);
    });
    return this.findOne(user, id);
  }

  async addService(
    user: AuthUser,
    id: string,
    dto: CreateVehicleServiceDto,
  ): Promise<VehicleDetailDto> {
    const companyId = user.companyId;
    const date = parseDateOnly(dto.serviceDate);
    assertNotFuture(date, fleetToday());
    if (dto.partnerId) {
      const partner = await this.prisma.businessPartner.findFirst({
        where: { id: dto.partnerId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!partner) throw new BadRequestException('Partner not found');
    }
    await this.prisma.$transaction(async (tx) => {
      const vehicle = await lockVehicle(tx, companyId, id);
      const odometer = dto.odometer ?? null;
      if (odometer !== null) await assertOdometer(tx, id, date, odometer);
      const service = await tx.vehicleService.create({
        data: {
          companyId,
          vehicleId: id,
          type: dto.type,
          serviceDate: date,
          odometer,
          partnerId: dto.partnerId ?? null,
          description: dto.description.trim(),
          cost: dto.cost,
          createdById: user.id,
        },
      });
      if (odometer !== null) {
        await tx.vehicleOdometerReading.create({
          data: {
            vehicleId: id,
            readingDate: date,
            odometer,
            source: VehicleOdometerSource.SERVICE,
            serviceId: service.id,
            createdById: user.id,
          },
        });
        await refreshOdometer(tx, id);
      }
      if (dto.type !== VehicleServiceType.PERIODIC) return;
      const later = await tx.vehicleService.count({
        where: {
          vehicleId: id,
          type: VehicleServiceType.PERIODIC,
          serviceDate: { gt: date },
        },
      });
      if (later) return;
      const schedule = nextService(
        date,
        odometer ?? (await this.odometerAt(tx, vehicle, date, undefined)),
        vehicle.serviceIntervalKm,
        vehicle.serviceIntervalMonths,
      );
      await tx.vehicle.update({
        where: { id },
        data: {
          nextServiceKm:
            dto.nextServiceKm !== undefined ? dto.nextServiceKm : schedule.nextServiceKm,
          nextServiceDate:
            dto.nextServiceDate !== undefined
              ? dto.nextServiceDate
                ? parseDateOnly(dto.nextServiceDate)
                : null
              : schedule.nextServiceDate,
          serviceRemindedFor: null,
        },
      });
    });
    return this.findOne(user, id);
  }

  async removeService(user: AuthUser, id: string, serviceId: string): Promise<VehicleDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockVehicle(tx, user.companyId, id);
      const service = await tx.vehicleService.findFirst({
        where: { id: serviceId, vehicleId: id },
      });
      if (!service) throw new NotFoundException('Service not found');
      await tx.vehicleService.delete({ where: { id: serviceId } });
      await refreshOdometer(tx, id);
    });
    return this.findOne(user, id);
  }

  async addDocument(
    user: AuthUser,
    id: string,
    dto: CreateVehicleDocumentDto,
  ): Promise<VehicleDetailDto> {
    const companyId = user.companyId;
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, companyId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    const start = dto.startDate ? parseDateOnly(dto.startDate) : null;
    const end = parseDateOnly(dto.endDate);
    if (start && end < start) {
      throw new BadRequestException('End date cannot be before the start date');
    }
    await this.prisma.vehicleDocument.create({
      data: {
        companyId,
        vehicleId: id,
        type: dto.type,
        startDate: start,
        endDate: end,
        provider: trimOrNull(dto.provider) ?? null,
        policyNumber: trimOrNull(dto.policyNumber) ?? null,
        cost: dto.cost ?? 0,
        note: trimOrNull(dto.note) ?? null,
        createdById: user.id,
      },
    });
    return this.findOne(user, id);
  }

  async removeDocument(user: AuthUser, id: string, documentId: string): Promise<VehicleDetailDto> {
    const document = await this.prisma.vehicleDocument.findFirst({
      where: { id: documentId, vehicleId: id, companyId: user.companyId },
    });
    if (!document) throw new NotFoundException('Document not found');
    await this.prisma.vehicleDocument.delete({ where: { id: documentId } });
    return this.findOne(user, id);
  }

  private async toDtos(rows: VehicleRow[]): Promise<VehicleDto[]> {
    const today = fleetToday();
    const facts = await yearFacts(this.prisma, rows, today.getUTCFullYear());
    return rows.map((row) => toVehicleDto(row, facts.get(row.id), today));
  }

  private async stats(
    vehicleId: string,
    year: number,
    readings: { readingDate: Date; odometer: number }[],
  ): Promise<VehicleYearStatsDto> {
    const range = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
    const [fuel, services, documents] = await Promise.all([
      this.prisma.vehicleFuelEntry.findMany({
        where: { vehicleId, entryDate: range },
        select: {
          id: true,
          entryDate: true,
          odometer: true,
          liters: true,
          fullTank: true,
          amount: true,
        },
      }),
      this.prisma.vehicleService.findMany({
        where: { vehicleId, serviceDate: range },
        select: { serviceDate: true, cost: true },
      }),
      this.prisma.vehicleDocument.findMany({
        where: { vehicleId },
        select: { startDate: true, endDate: true, cost: true },
      }),
    ]);
    const km = monthlyKm(readings, year);
    const months = km.map((value, index) => {
      const inMonth = (date: Date) => date.getUTCMonth() === index;
      const entries = fuel.filter((f) => inMonth(f.entryDate));
      return {
        month: index + 1,
        km: value,
        liters: entries.reduce((sum, f) => sum.plus(f.liters), ZERO),
        fuelCost: entries.reduce((sum, f) => sum.plus(f.amount), ZERO),
        serviceCost: services
          .filter((s) => inMonth(s.serviceDate))
          .reduce((sum, s) => sum.plus(s.cost), ZERO),
        documentCost: documents
          .filter((d) => {
            const date = documentCostDate(d);
            return date.getUTCFullYear() === year && inMonth(date);
          })
          .reduce((sum, d) => sum.plus(d.cost), ZERO),
      };
    });
    const total = (key: 'liters' | 'fuelCost' | 'serviceCost' | 'documentCost') =>
      months.reduce((sum, m) => sum.plus(m[key]), ZERO);
    const yearKm = km.reduce((sum, value) => sum + value, 0);
    const totalCost = total('fuelCost').plus(total('serviceCost')).plus(total('documentCost'));
    return {
      year,
      km: yearKm,
      liters: total('liters').toFixed(2),
      fuelCost: total('fuelCost').toFixed(2),
      serviceCost: total('serviceCost').toFixed(2),
      documentCost: total('documentCost').toFixed(2),
      totalCost: totalCost.toFixed(2),
      costPerKm: costPerKm(totalCost, yearKm)?.toFixed(2) ?? null,
      consumption: averageConsumption(fuel)?.toFixed(2) ?? null,
      months: months.map((m) => ({
        month: m.month,
        km: m.km,
        liters: m.liters.toFixed(2),
        fuelCost: m.fuelCost.toFixed(2),
        serviceCost: m.serviceCost.toFixed(2),
        documentCost: m.documentCost.toFixed(2),
      })),
    };
  }

  private async assertDepartment(companyId: string, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!department) throw new BadRequestException('Department not found');
  }

  private readings(tx: PrismaTx, vehicleId: string) {
    return tx.vehicleOdometerReading.findMany({
      where: { vehicleId },
      select: { readingDate: true, odometer: true },
    });
  }

  /** The given odometer checked against the history, or the last known value on that day. */
  private async odometerAt(
    tx: PrismaTx,
    vehicle: { id: string; odometer: number },
    date: Date,
    odometer: number | undefined,
  ): Promise<number> {
    if (odometer !== undefined) {
      await assertOdometer(tx, vehicle.id, date, odometer);
      return odometer;
    }
    const readings = await this.readings(tx, vehicle.id);
    const { min, max } = odometerRange(readings, date);
    return readings.some((r) => r.readingDate <= date) ? min : (max ?? vehicle.odometer);
  }

  private writeReading(
    tx: PrismaTx,
    vehicleId: string,
    date: Date,
    odometer: number,
    source: VehicleOdometerSource,
    userId: string,
  ) {
    return tx.vehicleOdometerReading
      .create({ data: { vehicleId, readingDate: date, odometer, source, createdById: userId } })
      .then(() => refreshOdometer(tx, vehicleId));
  }

  private async closeOpenAssignment(
    tx: PrismaTx,
    vehicle: { id: string; odometer: number },
    date: Date,
  ) {
    const open = await tx.vehicleAssignment.findFirst({
      where: { vehicleId: vehicle.id, endDate: null },
    });
    if (!open) return;
    await tx.vehicleAssignment.update({
      where: { id: open.id },
      data: {
        endDate: date < open.startDate ? open.startDate : date,
        endOdometer: Math.max(vehicle.odometer, open.startOdometer),
      },
    });
  }
}

function toPlate(value: string): string {
  const plate = normalizePlate(value);
  if (!plate) throw new BadRequestException('Plate is not a valid Turkish plate');
  return plate;
}
