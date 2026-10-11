import type { Paginated, PaginationQueryDto } from './pagination.dto';

export interface PageArgs {
  skip: number;
  take: number;
}

export function toPageArgs(query: PaginationQueryDto): PageArgs {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/**
 * Returns a Prisma `orderBy` for `sortBy` only when it is in the allow-list,
 * so arbitrary column names from the query string never reach the database.
 */
export function toOrderBy<F extends string>(
  query: PaginationQueryDto,
  allowed: readonly F[],
  fallback: F,
): Record<F, 'asc' | 'desc'> {
  const field = allowed.includes(query.sortBy as F) ? (query.sortBy as F) : fallback;
  return { [field]: query.sortOrder ?? 'desc' } as Record<F, 'asc' | 'desc'>;
}

export function paginated<T>(data: T[], total: number, query: PaginationQueryDto): Paginated<T> {
  return {
    data,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}
