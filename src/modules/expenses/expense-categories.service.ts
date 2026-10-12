import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseCategoryKind, Prisma, type ExpenseCategory } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateExpenseCategoryDto,
  ExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense.dto';

/** Expense types (yemek, konaklama, harcırah, km...) with their allowance rates and limits. */
@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<ExpenseCategoryDto[]> {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toCategoryDto);
  }

  async create(companyId: string, dto: CreateExpenseCategoryDto): Promise<ExpenseCategoryDto> {
    const kind = dto.kind ?? ExpenseCategoryKind.RECEIPT;
    assertRate(kind, dto.rate);
    try {
      const row = await this.prisma.expenseCategory.create({
        data: {
          companyId,
          code: dto.code,
          name: dto.name.trim(),
          kind,
          rate: kind === ExpenseCategoryKind.RECEIPT ? null : dto.rate,
          limitAmount: dto.limitAmount ?? null,
          requiresReceipt: kind === ExpenseCategoryKind.RECEIPT && (dto.requiresReceipt ?? true),
          isActive: dto.isActive ?? true,
        },
      });
      return toCategoryDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Category code ${dto.code} already exists`);
      }
      throw error;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateExpenseCategoryDto,
  ): Promise<ExpenseCategoryDto> {
    const current = await this.get(companyId, id);
    const isReceipt = current.kind === ExpenseCategoryKind.RECEIPT;
    if (dto.rate !== undefined) assertRate(current.kind, dto.rate);
    const row = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        rate: isReceipt ? undefined : dto.rate,
        limitAmount: dto.limitAmount,
        requiresReceipt: isReceipt ? dto.requiresReceipt : undefined,
        isActive: dto.isActive,
      },
    });
    return toCategoryDto(row);
  }

  async get(companyId: string, id: string): Promise<ExpenseCategory> {
    const row = await this.prisma.expenseCategory.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Expense category not found');
    return row;
  }
}

function assertRate(kind: ExpenseCategoryKind, rate: number | null | undefined) {
  if (kind !== ExpenseCategoryKind.RECEIPT && !rate) {
    throw new BadRequestException('Per diem and mileage categories need a rate');
  }
}

export function toCategoryDto(row: ExpenseCategory): ExpenseCategoryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    rate: row.rate?.toFixed(2) ?? null,
    limitAmount: row.limitAmount?.toFixed(2) ?? null,
    requiresReceipt: row.requiresReceipt,
    isActive: row.isActive,
  };
}
