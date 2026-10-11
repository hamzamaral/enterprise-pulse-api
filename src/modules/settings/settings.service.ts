import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateCurrencyDto,
  CreateExchangeRateDto,
  CreateTaxRateDto,
  CreateUnitDto,
  ExchangeRateQueryDto,
  UpdateCurrencyDto,
  UpdateTaxRateDto,
  UpdateUnitDto,
} from './dto/settings.dto';

const decimalToString = <T extends Record<string, unknown>>(row: T, fields: (keyof T)[]) => {
  const copy: Record<string, unknown> = { ...row };
  for (const field of fields) copy[field as string] = String(row[field]);
  return copy as { [K in keyof T]: T[K] extends Prisma.Decimal ? string : T[K] };
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Currencies: global, only super admins may change them ----------

  findCurrencies() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  createCurrency(user: AuthUser, dto: CreateCurrencyDto) {
    this.assertSuperAdmin(user);
    return this.prisma.currency.create({ data: dto });
  }

  updateCurrency(user: AuthUser, code: string, dto: UpdateCurrencyDto) {
    this.assertSuperAdmin(user);
    return this.prisma.currency.update({ where: { code }, data: dto });
  }

  // ---------- Exchange rates ----------

  async findExchangeRates(query: ExchangeRateQueryDto) {
    const where: Prisma.ExchangeRateWhereInput = { currencyCode: query.currencyCode };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.exchangeRate.findMany({
        where,
        orderBy: [{ rateDate: 'desc' }, { currencyCode: 'asc' }],
        ...toPageArgs(query),
      }),
      this.prisma.exchangeRate.count({ where }),
    ]);
    return paginated(
      rows.map((r) => decimalToString(r, ['buying', 'selling'])),
      total,
      query,
    );
  }

  async upsertExchangeRate(dto: CreateExchangeRateDto) {
    const row = await this.prisma.exchangeRate.upsert({
      where: {
        currencyCode_rateDate_source: {
          currencyCode: dto.currencyCode,
          rateDate: dto.rateDate,
          source: 'manual',
        },
      },
      create: { ...dto, source: 'manual' },
      update: { buying: dto.buying, selling: dto.selling },
    });
    return decimalToString(row, ['buying', 'selling']);
  }

  // ---------- Tax rates ----------

  async findTaxRates(companyId: string) {
    const rows = await this.prisma.taxRate.findMany({
      where: { companyId },
      orderBy: { rate: 'desc' },
    });
    return rows.map((r) => decimalToString(r, ['rate']));
  }

  async createTaxRate(companyId: string, dto: CreateTaxRateDto) {
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.taxRate.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.taxRate.create({ data: { ...dto, companyId } });
    });
    return decimalToString(row, ['rate']);
  }

  async updateTaxRate(companyId: string, id: string, dto: UpdateTaxRateDto) {
    await this.findOwned('taxRate', companyId, id);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.taxRate.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.taxRate.update({ where: { id }, data: dto });
    });
    return decimalToString(row, ['rate']);
  }

  // ---------- Units ----------

  findUnits(companyId: string) {
    return this.prisma.unit.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  createUnit(companyId: string, dto: CreateUnitDto) {
    return this.prisma.unit.create({ data: { ...dto, companyId } });
  }

  async updateUnit(companyId: string, id: string, dto: UpdateUnitDto) {
    await this.findOwned('unit', companyId, id);
    return this.prisma.unit.update({ where: { id }, data: dto });
  }

  // ---------- Company key / value settings ----------

  findCompanySettings(companyId: string) {
    return this.prisma.setting.findMany({
      where: { companyId },
      select: { key: true, value: true, updatedAt: true },
      orderBy: { key: 'asc' },
    });
  }

  upsertCompanySetting(companyId: string, key: string, value: unknown) {
    const json = value as Prisma.InputJsonValue;
    return this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key } },
      create: { companyId, key, value: json },
      update: { value: json },
      select: { key: true, value: true, updatedAt: true },
    });
  }

  private assertSuperAdmin(user: AuthUser): void {
    if (!user.isSuperAdmin)
      throw new ForbiddenException('Only system administrators can manage currencies');
  }

  private async findOwned(model: 'taxRate' | 'unit', companyId: string, id: string): Promise<void> {
    const count =
      model === 'taxRate'
        ? await this.prisma.taxRate.count({ where: { id, companyId } })
        : await this.prisma.unit.count({ where: { id, companyId } });
    if (!count) throw new NotFoundException('Record not found');
  }
}
