import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AssetAssignmentsService } from '../assets/asset-assignments.service';
import { NumberingService } from '../numbering/numbering.service';
import { parseDateOnly, toDateOnly } from '../../common/dates/date-only';
import type {
  CreateEmployeeDto,
  EmployeeDetailDto,
  EmployeeDto,
  EmployeeQueryDto,
  OrgChartNodeDto,
  TerminateEmployeeDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

const SORTABLE = ['employeeNo', 'firstName', 'lastName', 'hireDate', 'createdAt'] as const;

const listInclude = {
  department: { select: { name: true } },
  position: { select: { name: true } },
  branch: { select: { name: true } },
  manager: { select: { firstName: true, lastName: true } },
} satisfies Prisma.EmployeeInclude;

const detailInclude = {
  ...listInclude,
  user: { select: { email: true } },
  reports: {
    where: { deletedAt: null, status: EmployeeStatus.ACTIVE },
    select: { id: true, employeeNo: true, firstName: true, lastName: true },
    orderBy: { firstName: 'asc' },
  },
} satisfies Prisma.EmployeeInclude;

type ListRow = Prisma.EmployeeGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.EmployeeGetPayload<{ include: typeof detailInclude }>;

type EmployeeReferences = Pick<
  UpdateEmployeeDto,
  'branchId' | 'departmentId' | 'positionId' | 'managerId' | 'userId'
>;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly assetAssignments: AssetAssignmentsService,
  ) {}

  async findAll(companyId: string, query: EmployeeQueryDto) {
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      deletedAt: null,
      departmentId: query.departmentId,
      positionId: query.positionId,
      branchId: query.branchId,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { employeeNo: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: listInclude,
        orderBy: toOrderBy(query, SORTABLE, 'employeeNo'),
        ...toPageArgs(query),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(companyId: string, id: string): Promise<EmployeeDetailDto> {
    const row = await this.prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Employee not found');
    return toDetailDto(row);
  }

  /** Employee record linked to the current user, used by self-service screens. */
  async findMine(companyId: string, userId: string): Promise<EmployeeDetailDto> {
    const row = await this.prisma.employee.findFirst({
      where: { companyId, userId, deletedAt: null },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('No employee record is linked to your account');
    return toDetailDto(row);
  }

  async create(companyId: string, dto: CreateEmployeeDto): Promise<EmployeeDetailDto> {
    await this.assertReferences(companyId, dto);
    const id = await this.prisma.$transaction(async (tx) => {
      const employeeNo = await this.numbering.next(companyId, 'EMPLOYEE', tx);
      const row = await tx.employee.create({
        data: {
          ...toData(dto),
          firstName: dto.firstName,
          lastName: dto.lastName,
          companyId,
          employeeNo,
          hireDate: parseDateOnly(dto.hireDate),
        },
        select: { id: true },
      });
      return row.id;
    });
    return this.findOne(companyId, id);
  }

  async update(companyId: string, id: string, dto: UpdateEmployeeDto): Promise<EmployeeDetailDto> {
    await this.findOne(companyId, id);
    await this.assertReferences(companyId, dto, id);
    await this.prisma.employee.update({
      where: { id },
      data: {
        ...toData(dto),
        ...(dto.hireDate ? { hireDate: parseDateOnly(dto.hireDate) } : {}),
      },
    });
    return this.findOne(companyId, id);
  }

  async terminate(
    companyId: string,
    id: string,
    dto: TerminateEmployeeDto,
  ): Promise<EmployeeDetailDto> {
    const employee = await this.findOne(companyId, id);
    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new ConflictException('Employee is already terminated');
    }
    if (dto.terminationDate < employee.hireDate) {
      throw new BadRequestException('Termination date cannot be before the hire date');
    }
    const heldAssets = await this.assetAssignments.countActiveForEmployee(companyId, id);
    if (heldAssets > 0) {
      throw new ConflictException(
        `Employee still holds ${heldAssets} asset(s); return them before termination`,
      );
    }
    await this.prisma.employee.update({
      where: { id },
      data: {
        status: EmployeeStatus.TERMINATED,
        terminationDate: parseDateOnly(dto.terminationDate),
        terminationReason: dto.reason,
      },
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.findOne(companyId, id);
    const [reports, requests] = await Promise.all([
      this.prisma.employee.count({ where: { companyId, managerId: id, deletedAt: null } }),
      this.prisma.leaveRequest.count({ where: { employeeId: id } }),
    ]);
    if (reports || requests) {
      throw new ConflictException('Employee has history; terminate the employee instead');
    }
    await this.prisma.$transaction([
      this.prisma.department.updateMany({ where: { managerId: id }, data: { managerId: null } }),
      this.prisma.employee.update({
        where: { id },
        data: { deletedAt: new Date(), userId: null },
      }),
    ]);
  }

  /** Reporting hierarchy of active employees built from `managerId`. */
  async orgChart(companyId: string): Promise<OrgChartNodeDto[]> {
    const rows = await this.prisma.employee.findMany({
      where: { companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        managerId: true,
        position: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const nodes = new Map<string, OrgChartNodeDto>(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          fullName: `${r.firstName} ${r.lastName}`,
          positionName: r.position?.name ?? null,
          departmentName: r.department?.name ?? null,
          children: [],
        },
      ]),
    );
    const roots: OrgChartNodeDto[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      const parent = row.managerId ? nodes.get(row.managerId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  private async assertReferences(
    companyId: string,
    dto: EmployeeReferences,
    selfId?: string,
  ): Promise<void> {
    const checks: Promise<void>[] = [];
    const exists = (count: Promise<number>, message: string) =>
      checks.push(
        count.then((n) => {
          if (!n) throw new BadRequestException(message);
        }),
      );

    if (dto.branchId) {
      exists(
        this.prisma.branch.count({ where: { id: dto.branchId, companyId } }),
        'Branch not found',
      );
    }
    if (dto.departmentId) {
      exists(
        this.prisma.department.count({
          where: { id: dto.departmentId, companyId, deletedAt: null },
        }),
        'Department not found',
      );
    }
    if (dto.positionId) {
      exists(
        this.prisma.position.count({ where: { id: dto.positionId, companyId, deletedAt: null } }),
        'Position not found',
      );
    }
    if (dto.userId) {
      exists(
        this.prisma.userCompany.count({ where: { userId: dto.userId, companyId } }),
        'User is not a member of this company',
      );
    }
    if (dto.managerId) checks.push(this.assertManager(companyId, dto.managerId, selfId));
    await Promise.all(checks);
  }

  private async assertManager(companyId: string, managerId: string, selfId?: string) {
    if (managerId === selfId) throw new BadRequestException('An employee cannot manage themselves');
    const all = await this.prisma.employee.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, managerId: true },
    });
    const byId = new Map(all.map((e) => [e.id, e.managerId]));
    if (!byId.has(managerId)) throw new BadRequestException('Manager employee not found');
    if (!selfId) return;
    for (let cursor: string | null | undefined = managerId; cursor; cursor = byId.get(cursor)) {
      if (cursor === selfId)
        throw new BadRequestException('Reporting hierarchy cannot be circular');
    }
  }
}

function toData(dto: UpdateEmployeeDto) {
  const { hireDate: _hireDate, birthDate, ...rest } = dto;
  return {
    ...rest,
    ...(birthDate !== undefined ? { birthDate: birthDate ? parseDateOnly(birthDate) : null } : {}),
  };
}

function toDto(row: ListRow): EmployeeDto {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`,
    email: row.email,
    phone: row.phone,
    status: row.status,
    employmentType: row.employmentType,
    hireDate: toDateOnly(row.hireDate),
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    positionId: row.positionId,
    positionName: row.position?.name ?? null,
    branchId: row.branchId,
    branchName: row.branch?.name ?? null,
    managerId: row.managerId,
    managerName: row.manager ? `${row.manager.firstName} ${row.manager.lastName}` : null,
    userId: row.userId,
  };
}

function toDetailDto(row: DetailRow): EmployeeDetailDto {
  return {
    ...toDto(row),
    nationalId: row.nationalId,
    birthDate: toDateOnly(row.birthDate),
    gender: row.gender,
    address: row.address,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    terminationDate: toDateOnly(row.terminationDate),
    terminationReason: row.terminationReason,
    userEmail: row.user?.email ?? null,
    reports: row.reports.map((r) => ({
      id: r.id,
      employeeNo: r.employeeNo,
      fullName: `${r.firstName} ${r.lastName}`,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
