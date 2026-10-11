import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContext } from '../../common/context/request-context';

/** Models that are either audit data themselves or too noisy / sensitive to audit. */
const SKIPPED_MODELS = new Set<string>([
  'AuditLog',
  'Notification',
  'RefreshToken',
  'PasswordResetToken',
  'NumberSequence',
]);

const REDACTED_FIELDS = new Set(['passwordHash', 'twoFactorSecret', 'tokenHash']);

const logger = new Logger('AuditExtension');

function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_FIELDS.has(key)) result[key] = '[REDACTED]';
    else if (field instanceof Date) result[key] = field.toISOString();
    else if (field instanceof Prisma.Decimal) result[key] = field.toString();
    else if (typeof field !== 'object' || field === null) result[key] = field;
  }
  return result as Prisma.InputJsonValue;
}

/** Only keeps the fields that actually changed so the audit trail stays readable. */
function diff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): { oldValues?: Prisma.InputJsonValue; newValues?: Prisma.InputJsonValue } {
  if (!before || !after) return { oldValues: before as never, newValues: after as never };
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === 'updatedAt') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      oldValues[key] = before[key];
      newValues[key] = after[key];
    }
  }
  return {
    oldValues: oldValues as Prisma.InputJsonValue,
    newValues: newValues as Prisma.InputJsonValue,
  };
}

function delegate(client: PrismaClient, model: string) {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (client as unknown as Record<string, { findUnique: (args: unknown) => Promise<unknown> }>)[
    key
  ];
}

/**
 * Writes an AuditLog row for every single-record create / update / delete.
 * The audit insert uses the base (non-extended) client so it never re-enters this extension.
 */
export function auditExtension(base: PrismaClient) {
  const write = async (
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    model: string,
    entityId: string | undefined,
    oldValues?: Prisma.InputJsonValue,
    newValues?: Prisma.InputJsonValue,
  ) => {
    const ctx = RequestContext.get();
    try {
      await base.auditLog.create({
        data: {
          action,
          entityType: model,
          entityId,
          oldValues,
          newValues,
          userId: ctx?.userId,
          userEmail: ctx?.userEmail,
          companyId: ctx?.companyId,
          ip: ctx?.ip,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
        },
      });
    } catch (error) {
      logger.error(`Failed to write audit log for ${model}: ${String(error)}`);
    }
  };

  return Prisma.defineExtension({
    name: 'audit',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (!SKIPPED_MODELS.has(model)) {
            const after = sanitize(result) as Record<string, unknown> | undefined;
            await write(
              'CREATE',
              model,
              after?.id as string | undefined,
              undefined,
              after as never,
            );
          }
          return result;
        },
        async update({ model, args, query }) {
          if (SKIPPED_MODELS.has(model)) return query(args);
          const before = sanitize(await delegate(base, model).findUnique({ where: args.where }));
          const result = await query(args);
          const after = sanitize(result);
          const changes = diff(
            before as Record<string, unknown> | undefined,
            after as Record<string, unknown> | undefined,
          );
          const id = (after as Record<string, unknown> | undefined)?.id as string | undefined;
          await write('UPDATE', model, id, changes.oldValues, changes.newValues);
          return result;
        },
        async delete({ model, args, query }) {
          const result = await query(args);
          if (!SKIPPED_MODELS.has(model)) {
            const before = sanitize(result) as Record<string, unknown> | undefined;
            await write('DELETE', model, before?.id as string | undefined, before as never);
          }
          return result;
        },
      },
    },
  });
}
