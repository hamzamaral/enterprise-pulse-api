import { BadRequestException, Injectable } from '@nestjs/common';
import { PayrollPeriodStatus, Prisma, type PayrollParameter } from '@prisma/client';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type { PayrollParameterDto, UpdatePayrollParameterDto } from './dto/payroll.dto';
import { DEFAULT_RATES, type PayrollRates, type TaxBracket } from './payroll-math';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const percent = (fraction: Prisma.Decimal.Value) => dec(fraction).mul(100).toDecimalPlaces(4);
const fraction = (value: number) => dec(value).div(100);

function toRates(row: PayrollParameter): PayrollRates {
  return {
    minimumWage: row.minimumWage,
    sgkCeiling: row.sgkCeiling,
    sgkEmployeeRate: row.sgkEmployeeRate,
    unemploymentEmployeeRate: row.unemploymentEmployeeRate,
    sgkEmployerRate: row.sgkEmployerRate,
    unemploymentEmployerRate: row.unemploymentEmployerRate,
    stampTaxRate: row.stampTaxRate,
    overtimeRate: row.overtimeRate,
    monthlyHours: row.monthlyHours,
    taxBrackets: row.taxBrackets as unknown as TaxBracket[],
  };
}

/** Yearly payroll figures; a year without saved figures runs on `DEFAULT_RATES`. */
@Injectable()
export class PayrollSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<PayrollParameterDto[]> {
    const rows = await this.prisma.payrollParameter.findMany({
      where: { companyId },
      orderBy: { year: 'desc' },
    });
    return Promise.all(rows.map((row) => this.toDto(companyId, row.year, toRates(row), true)));
  }

  async findOne(companyId: string, year: number): Promise<PayrollParameterDto> {
    const row = await this.prisma.payrollParameter.findUnique({
      where: { companyId_year: { companyId, year } },
    });
    return this.toDto(companyId, year, row ? toRates(row) : DEFAULT_RATES, !!row);
  }

  async update(
    companyId: string,
    year: number,
    dto: UpdatePayrollParameterDto,
  ): Promise<PayrollParameterDto> {
    const brackets = dto.taxBrackets;
    brackets.forEach((bracket, index) => {
      const last = index === brackets.length - 1;
      if (last !== (bracket.upTo === null)) {
        throw new BadRequestException('Only the last tax bracket is open-ended');
      }
      const previous = brackets[index - 1]?.upTo;
      if (bracket.upTo !== null && previous != null && bracket.upTo <= previous) {
        throw new BadRequestException('Tax bracket limits must increase');
      }
    });
    if (dec(dto.sgkCeiling).lt(dto.minimumWage)) {
      throw new BadRequestException('The SGK ceiling cannot be below the minimum wage');
    }
    const data = {
      minimumWage: dto.minimumWage,
      sgkCeiling: dto.sgkCeiling,
      sgkEmployeeRate: fraction(dto.sgkEmployeeRate),
      unemploymentEmployeeRate: fraction(dto.unemploymentEmployeeRate),
      sgkEmployerRate: fraction(dto.sgkEmployerRate),
      unemploymentEmployerRate: fraction(dto.unemploymentEmployerRate),
      stampTaxRate: fraction(dto.stampTaxRate),
      overtimeRate: dto.overtimeRate,
      monthlyHours: dto.monthlyHours,
      taxBrackets: brackets.map((bracket) => ({
        upTo: bracket.upTo === null ? null : dec(bracket.upTo).toFixed(2),
        rate: fraction(bracket.rate).toString(),
      })),
    };
    await this.prisma.payrollParameter.upsert({
      where: { companyId_year: { companyId, year } },
      create: { companyId, year, ...data },
      update: data,
    });
    return this.findOne(companyId, year);
  }

  /** Figures of a year; the defaults are saved on first use so a period always has a record. */
  async ratesFor(tx: PrismaTx, companyId: string, year: number): Promise<PayrollRates> {
    const row = await tx.payrollParameter.findUnique({
      where: { companyId_year: { companyId, year } },
    });
    if (row) return toRates(row);
    const created = await tx.payrollParameter.create({
      data: {
        companyId,
        year,
        ...DEFAULT_RATES,
        taxBrackets: DEFAULT_RATES.taxBrackets as unknown as Prisma.InputJsonValue,
      },
    });
    return toRates(created);
  }

  private async toDto(
    companyId: string,
    year: number,
    rates: PayrollRates,
    saved: boolean,
  ): Promise<PayrollParameterDto> {
    const used = await this.prisma.payrollPeriod.count({
      where: { companyId, year, status: { not: PayrollPeriodStatus.DRAFT } },
    });
    return {
      year,
      saved,
      minimumWage: dec(rates.minimumWage).toFixed(2),
      sgkCeiling: dec(rates.sgkCeiling).toFixed(2),
      sgkEmployeeRate: percent(rates.sgkEmployeeRate).toString(),
      unemploymentEmployeeRate: percent(rates.unemploymentEmployeeRate).toString(),
      sgkEmployerRate: percent(rates.sgkEmployerRate).toString(),
      unemploymentEmployerRate: percent(rates.unemploymentEmployerRate).toString(),
      stampTaxRate: percent(rates.stampTaxRate).toString(),
      overtimeRate: dec(rates.overtimeRate).toString(),
      monthlyHours: rates.monthlyHours,
      taxBrackets: rates.taxBrackets.map((bracket) => ({
        upTo: bracket.upTo,
        rate: percent(bracket.rate).toString(),
      })),
      usedByPeriods: used > 0,
    };
  }
}
