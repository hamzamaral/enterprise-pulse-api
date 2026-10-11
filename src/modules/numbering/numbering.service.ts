import { Injectable, NotFoundException } from '@nestjs/common';
import type { NumberSequence } from '@prisma/client';
import { PrismaService, PrismaTx } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateNumberSequenceDto,
  NumberSequenceDto,
  UpdateNumberSequenceDto,
} from './dto/number-sequence.dto';
import { formatNumber } from './number-format';

@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserves the next document number. The row is locked with SELECT ... FOR UPDATE so concurrent
   * requests never receive the same number. Pass `tx` to make the number part of a larger transaction.
   */
  async next(companyId: string, code: string, tx?: PrismaTx): Promise<string> {
    const run = async (client: PrismaTx) => {
      const rows = await client.$queryRaw<NumberSequence[]>`
        SELECT * FROM number_sequences WHERE "companyId" = ${companyId}::uuid AND code = ${code} FOR UPDATE`;
      const sequence = rows[0];
      if (!sequence) throw new NotFoundException(`Number sequence "${code}" is not defined`);

      const year = new Date().getFullYear();
      const value = sequence.resetYearly && sequence.currentYear !== year ? 1 : sequence.nextValue;

      await client.numberSequence.update({
        where: { id: sequence.id },
        data: { currentYear: year, nextValue: value + 1 },
      });
      return formatNumber(sequence, year, value);
    };

    return tx ? run(tx) : this.prisma.$transaction((client) => run(client));
  }

  async findAll(companyId: string): Promise<NumberSequenceDto[]> {
    const rows = await this.prisma.numberSequence.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(companyId: string, dto: CreateNumberSequenceDto): Promise<NumberSequenceDto> {
    const row = await this.prisma.numberSequence.create({
      data: { ...dto, companyId, currentYear: new Date().getFullYear() },
    });
    return toDto(row);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateNumberSequenceDto,
  ): Promise<NumberSequenceDto> {
    const existing = await this.prisma.numberSequence.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Number sequence not found');
    return toDto(await this.prisma.numberSequence.update({ where: { id }, data: dto }));
  }
}

function toDto(row: NumberSequence): NumberSequenceDto {
  const year = new Date().getFullYear();
  const nextValue = row.resetYearly && row.currentYear !== year ? 1 : row.nextValue;
  return { ...row, preview: formatNumber(row, year, nextValue) };
}
