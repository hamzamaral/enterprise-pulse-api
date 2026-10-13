import { Prisma, TicketPriority, TicketStatus } from '@prisma/client';
import type { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { TicketDto } from './dto/support.dto';
import { DEFAULT_SLA, slaState, type SlaTargets } from './support-math';

export const TICKET_ENTITY = 'Ticket';

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;

export const trimOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

const userName = { select: { firstName: true, lastName: true } } as const;

export const ticketInclude = {
  category: { select: { name: true } },
  requester: userName,
  assignee: userName,
  _count: { select: { comments: { where: { isInternal: false } } } },
} satisfies Prisma.TicketInclude;

export type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export function toTicketDto(row: TicketRow, now: Date): TicketDto {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    requesterId: row.requesterId,
    requesterName: fullName(row.requester),
    assigneeId: row.assigneeId,
    assigneeName: row.assignee ? fullName(row.assignee) : null,
    firstResponseDueAt: row.firstResponseDueAt.toISOString(),
    resolutionDueAt: row.resolutionDueAt.toISOString(),
    firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    ...slaStates(row, now),
    commentCount: row._count.comments,
    satisfactionRating: row.satisfactionRating,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type SlaFields = Pick<
  TicketRow,
  | 'status'
  | 'createdAt'
  | 'firstResponseDueAt'
  | 'firstRespondedAt'
  | 'resolutionDueAt'
  | 'resolvedAt'
  | 'closedAt'
  | 'pausedAt'
>;

/** A ticket closed without a reply or resolution counts as answered when it was closed. */
export function slaStates(row: SlaFields, now: Date) {
  const finishedAt = row.status === TicketStatus.CLOSED ? row.closedAt : null;
  return {
    responseSla: slaState({
      startedAt: row.createdAt,
      dueAt: row.firstResponseDueAt,
      doneAt: row.firstRespondedAt ?? finishedAt,
      now,
    }),
    resolutionSla: slaState({
      startedAt: row.createdAt,
      dueAt: row.resolutionDueAt,
      doneAt: row.resolvedAt ?? finishedAt,
      pausedAt: row.pausedAt,
      now,
    }),
  };
}

/** The company's SLA targets for every priority, falling back to the defaults. */
export async function slaTargets(
  client: PrismaService | PrismaTx,
  companyId: string,
): Promise<Record<TicketPriority, SlaTargets>> {
  const rows = await client.ticketSlaPolicy.findMany({ where: { companyId } });
  const targets = { ...DEFAULT_SLA };
  for (const row of rows) {
    targets[row.priority] = {
      firstResponseHours: row.firstResponseHours,
      resolutionHours: row.resolutionHours,
    };
  }
  return targets;
}

/** Serialises changes to one ticket. */
export async function lockTicket(tx: PrismaTx, id: string) {
  await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${id}::uuid FOR UPDATE`;
}
