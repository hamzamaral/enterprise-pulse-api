import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetStatus,
  AssigneeType,
  AssignmentStatus,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { parseDateOnly } from '../../common/dates/date-only';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  assigneeOf,
  assignmentInclude,
  toAssignmentDto,
  type AssignmentRow,
} from './asset-mappers';
import { AssetsService } from './assets.service';
import type {
  AssignAssetDto,
  AssignmentDocumentDto,
  AssignmentDto,
  AssignmentQueryDto,
  ReturnAssetDto,
} from './dto/asset.dto';

const SORTABLE = ['number', 'assignedAt', 'createdAt'] as const;

const documentInclude = {
  ...assignmentInclude,
  asset: {
    select: {
      assetTag: true,
      name: true,
      brand: true,
      model: true,
      serialNumber: true,
      category: { select: { name: true } },
    },
  },
  company: { select: { name: true, legalName: true, address: true, city: true } },
} satisfies Prisma.AssetAssignmentInclude;

@Injectable()
export class AssetAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly assets: AssetsService,
  ) {}

  async findAll(companyId: string, query: AssignmentQueryDto) {
    const where: Prisma.AssetAssignmentWhereInput = {
      companyId,
      status: query.status,
      assigneeType: query.assigneeType,
      assetId: query.assetId,
      employeeId: query.employeeId,
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { asset: { assetTag: { contains: query.search, mode: 'insensitive' } } },
              { asset: { name: { contains: query.search, mode: 'insensitive' } } },
              { employee: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { employee: { lastName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assetAssignment.findMany({
        where,
        include: assignmentInclude,
        orderBy: toOrderBy(query, SORTABLE, 'assignedAt'),
        ...toPageArgs(query),
      }),
      this.prisma.assetAssignment.count({ where }),
    ]);
    return paginated(rows.map(toAssignmentDto), total, query);
  }

  /** Assignments of the employee record linked to the current user, newest first. */
  async findMine(user: AuthUser): Promise<AssignmentDto[]> {
    const rows = await this.prisma.assetAssignment.findMany({
      where: { companyId: user.companyId, employee: { userId: user.id } },
      include: assignmentInclude,
      orderBy: [{ status: 'asc' }, { assignedAt: 'desc' }],
    });
    return rows.map(toAssignmentDto);
  }

  /** Data for the printable hand-over form (zimmet tutanağı). */
  async findDocument(user: AuthUser, id: string): Promise<AssignmentDocumentDto> {
    const row = await this.prisma.assetAssignment.findFirst({
      where: { id, companyId: user.companyId },
      include: documentInclude,
    });
    const isHolder = !!row?.employee && row.employee.userId === user.id;
    if (!row || !(isHolder || hasPermission(user, 'assets:read'))) {
      throw new NotFoundException('Assignment not found');
    }
    const { company, asset } = row;
    return {
      ...toAssignmentDto(row),
      companyName: company.legalName ?? company.name,
      companyAddress: [company.address, company.city].filter(Boolean).join(', ') || null,
      asset: {
        assetTag: asset.assetTag,
        name: asset.name,
        categoryName: asset.category.name,
        brand: asset.brand,
        model: asset.model,
        serialNumber: asset.serialNumber,
      },
      assignee: {
        name: assigneeOf(row).name,
        employeeNo: row.employee?.employeeNo ?? null,
        departmentName: row.employee?.department?.name ?? row.department?.name ?? null,
        positionName: row.employee?.position?.name ?? null,
      },
      canAcknowledge: isHolder && row.status === AssignmentStatus.ACTIVE && !row.acknowledgedAt,
    };
  }

  async acknowledge(user: AuthUser, id: string): Promise<AssignmentDocumentDto> {
    const row = await this.findDocument(user, id);
    if (!row.canAcknowledge) {
      throw new ForbiddenException('Only the employee holding the asset can acknowledge it once');
    }
    await this.prisma.assetAssignment.update({
      where: { id },
      data: { acknowledgedAt: new Date() },
    });
    return this.findDocument(user, id);
  }

  async assign(user: AuthUser, assetId: string, dto: AssignAssetDto): Promise<AssignmentDto> {
    const asset = await this.assets.get(user.companyId, assetId);
    if (asset.status !== AssetStatus.IN_STOCK) {
      throw new ConflictException('Only assets in stock can be assigned');
    }
    const assignee = await this.resolveAssignee(user.companyId, dto);
    const row = await this.prisma.$transaction((tx) =>
      this.createAssignment(tx, user, asset, dto, assignee),
    );
    await this.notifyHolder(row);
    return toAssignmentDto(row);
  }

  async return(user: AuthUser, assetId: string, dto: ReturnAssetDto): Promise<AssignmentDto> {
    const asset = await this.assets.get(user.companyId, assetId);
    const active = await this.getActive(assetId);
    const returnedAt = parseDateOnly(dto.returnedAt);
    if (returnedAt < active.assignedAt) {
      throw new BadRequestException('Return date cannot be before the assignment date');
    }
    if (dto.locationId) {
      const count = await this.prisma.assetLocation.count({
        where: { id: dto.locationId, companyId: user.companyId },
      });
      if (!count) throw new BadRequestException('Location not found');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assetAssignment.update({
        where: { id: active.id },
        data: {
          status: AssignmentStatus.RETURNED,
          returnedAt,
          conditionIn: dto.conditionIn,
          returnNotes: dto.returnNotes,
          returnedById: user.id,
        },
        include: assignmentInclude,
      });
      await tx.asset.update({
        where: { id: assetId },
        data: {
          status: AssetStatus.IN_STOCK,
          condition: dto.conditionIn,
          locationId: dto.locationId ?? asset.locationId,
        },
      });
      return updated;
    });
    return toAssignmentDto(row);
  }

  /** Closes the current assignment and opens a new one in a single transaction (devir). */
  async transfer(user: AuthUser, assetId: string, dto: AssignAssetDto): Promise<AssignmentDto> {
    const asset = await this.assets.get(user.companyId, assetId);
    const active = await this.getActive(assetId);
    const assignee = await this.resolveAssignee(user.companyId, dto);
    if (assigneeOf(active).id === assignee.id) {
      throw new BadRequestException('The asset is already assigned to this holder');
    }
    const transferDate = parseDateOnly(dto.assignedAt);
    if (transferDate < active.assignedAt) {
      throw new BadRequestException('Transfer date cannot be before the current assignment');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.assetAssignment.update({
        where: { id: active.id },
        data: {
          status: AssignmentStatus.RETURNED,
          returnedAt: transferDate,
          conditionIn: asset.condition,
          returnNotes: `Devir: ${assignee.name}`,
          returnedById: user.id,
        },
      });
      return this.createAssignment(tx, user, asset, dto, assignee);
    });
    await this.notifyHolder(row);
    return toAssignmentDto(row);
  }

  countActiveForEmployee(companyId: string, employeeId: string): Promise<number> {
    return this.prisma.assetAssignment.count({
      where: { companyId, employeeId, status: AssignmentStatus.ACTIVE },
    });
  }

  private async createAssignment(
    tx: PrismaTx,
    user: AuthUser,
    asset: { id: string; condition: AssignmentRow['conditionOut'] },
    dto: AssignAssetDto,
    assignee: { id: string; name: string },
  ): Promise<AssignmentRow> {
    const number = await this.numbering.next(user.companyId, 'ASSET_ASSIGNMENT', tx);
    const row = await tx.assetAssignment.create({
      data: {
        companyId: user.companyId,
        number,
        assetId: asset.id,
        assigneeType: dto.assigneeType,
        employeeId: dto.assigneeType === AssigneeType.EMPLOYEE ? assignee.id : null,
        departmentId: dto.assigneeType === AssigneeType.DEPARTMENT ? assignee.id : null,
        locationId: dto.assigneeType === AssigneeType.LOCATION ? assignee.id : null,
        assignedAt: parseDateOnly(dto.assignedAt),
        expectedReturnDate: dto.expectedReturnDate ? parseDateOnly(dto.expectedReturnDate) : null,
        conditionOut: asset.condition,
        notes: dto.notes,
        assignedById: user.id,
      },
      include: assignmentInclude,
    });
    await tx.asset.update({ where: { id: asset.id }, data: { status: AssetStatus.ASSIGNED } });
    return row;
  }

  private async getActive(assetId: string) {
    const active = await this.prisma.assetAssignment.findFirst({
      where: { assetId, status: AssignmentStatus.ACTIVE },
      include: assignmentInclude,
    });
    if (!active) throw new ConflictException('Asset is not assigned');
    return active;
  }

  private async resolveAssignee(
    companyId: string,
    dto: AssignAssetDto,
  ): Promise<{ id: string; name: string }> {
    switch (dto.assigneeType) {
      case AssigneeType.EMPLOYEE: {
        const employee = await this.prisma.employee.findFirst({
          where: { id: dto.employeeId, companyId, deletedAt: null },
        });
        if (!employee) throw new BadRequestException('Employee not found');
        if (employee.status !== EmployeeStatus.ACTIVE) {
          throw new BadRequestException('Assets can only be assigned to active employees');
        }
        return { id: employee.id, name: `${employee.firstName} ${employee.lastName}` };
      }
      case AssigneeType.DEPARTMENT: {
        const department = await this.prisma.department.findFirst({
          where: { id: dto.departmentId, companyId, deletedAt: null },
        });
        if (!department) throw new BadRequestException('Department not found');
        return { id: department.id, name: department.name };
      }
      case AssigneeType.LOCATION: {
        const location = await this.prisma.assetLocation.findFirst({
          where: { id: dto.locationId, companyId },
        });
        if (!location) throw new BadRequestException('Location not found');
        return { id: location.id, name: location.name };
      }
    }
  }

  private async notifyHolder(row: AssignmentRow) {
    const userId = row.employee?.userId;
    if (!userId) return;
    await this.notifications.notify({
      userIds: [userId],
      companyId: row.companyId,
      type: 'assets.assigned',
      title: 'Adınıza zimmet kaydı oluşturuldu',
      body: `${row.asset.assetTag} · ${row.asset.name} — teslim alındığını onaylayın.`,
      link: `/assets/assignments/${row.id}`,
    });
  }
}
