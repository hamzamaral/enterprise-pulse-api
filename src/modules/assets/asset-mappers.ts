import { AssignmentStatus, Prisma } from '@prisma/client';
import { toDateOnly } from '../../common/dates/date-only';
import type { AssetHolderDto, AssignmentDto, MaintenanceDto } from './dto/asset.dto';

const personName = { select: { firstName: true, lastName: true } } as const;

/** Relations needed to name whoever holds an assignment. */
export const assigneeInclude = {
  employee: {
    select: {
      firstName: true,
      lastName: true,
      employeeNo: true,
      userId: true,
      department: { select: { name: true } },
      position: { select: { name: true } },
    },
  },
  department: { select: { name: true } },
  location: { select: { name: true } },
} satisfies Prisma.AssetAssignmentInclude;

export const assignmentInclude = {
  ...assigneeInclude,
  asset: { select: { assetTag: true, name: true } },
  assignedBy: personName,
  returnedBy: personName,
} satisfies Prisma.AssetAssignmentInclude;

export type AssignmentRow = Prisma.AssetAssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

type AssigneeRow = Prisma.AssetAssignmentGetPayload<{ include: typeof assigneeInclude }>;

export function assigneeOf(row: AssigneeRow): { id: string; name: string } {
  if (row.employee && row.employeeId) {
    return { id: row.employeeId, name: `${row.employee.firstName} ${row.employee.lastName}` };
  }
  if (row.department && row.departmentId) {
    return { id: row.departmentId, name: row.department.name };
  }
  return { id: row.locationId ?? '', name: row.location?.name ?? '' };
}

export function toHolder(row: AssigneeRow | undefined): AssetHolderDto | null {
  if (!row || row.status !== AssignmentStatus.ACTIVE) return null;
  return { type: row.assigneeType, assignmentId: row.id, ...assigneeOf(row) };
}

export function toAssignmentDto(row: AssignmentRow): AssignmentDto {
  const assignee = assigneeOf(row);
  return {
    id: row.id,
    number: row.number,
    assetId: row.assetId,
    assetTag: row.asset.assetTag,
    assetName: row.asset.name,
    assigneeType: row.assigneeType,
    assigneeId: assignee.id,
    assigneeName: assignee.name,
    status: row.status,
    assignedAt: toDateOnly(row.assignedAt),
    expectedReturnDate: toDateOnly(row.expectedReturnDate),
    conditionOut: row.conditionOut,
    notes: row.notes,
    acknowledgedAt: row.acknowledgedAt,
    returnedAt: toDateOnly(row.returnedAt),
    conditionIn: row.conditionIn,
    returnNotes: row.returnNotes,
    assignedByName: `${row.assignedBy.firstName} ${row.assignedBy.lastName}`,
    returnedByName: row.returnedBy
      ? `${row.returnedBy.firstName} ${row.returnedBy.lastName}`
      : null,
  };
}

export function toMaintenanceDto(row: Prisma.AssetMaintenanceGetPayload<object>): MaintenanceDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    description: row.description,
    vendor: row.vendor,
    cost: row.cost?.toFixed(2) ?? null,
    startedAt: toDateOnly(row.startedAt),
    completedAt: toDateOnly(row.completedAt),
  };
}
