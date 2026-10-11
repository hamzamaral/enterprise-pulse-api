import { PrismaClient } from '@prisma/client';
import { auditExtension } from './audit.extension';

export function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  return base.$extends(auditExtension(base));
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Injection token + type for the audited Prisma client.
 * The class/interface merge lets services inject `PrismaService` and get full model typings.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class PrismaService {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface PrismaService extends ExtendedPrismaClient {}

/** Transaction client type for `prisma.$transaction(async (tx) => ...)` callbacks. */
export type PrismaTx = Parameters<Parameters<ExtendedPrismaClient['$transaction']>[0]>[0];
