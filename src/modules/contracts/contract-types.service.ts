import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  ContractTypeDto,
  CreateContractTypeDto,
  UpdateContractTypeDto,
} from './dto/contract.dto';
import { trimOrNull } from './contract-helpers';

/** Sözleşme türleri: party, money direction and the defaults for new contracts. */
@Injectable()
export class ContractTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<ContractTypeDto[]> {
    const [rows, active] = await Promise.all([
      this.prisma.contractType.findMany({
        where: { companyId },
        include: { _count: { select: { contracts: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.contract.groupBy({
        by: ['typeId'],
        where: { companyId, status: ContractStatus.ACTIVE },
        _count: true,
      }),
    ]);
    const activeByType = new Map(active.map((g) => [g.typeId, g._count]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      party: row.party,
      flow: row.flow,
      defaultTermMonths: row.defaultTermMonths,
      defaultNoticeDays: row.defaultNoticeDays,
      description: row.description,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      contractCount: row._count.contracts,
      activeCount: activeByType.get(row.id) ?? 0,
    }));
  }

  async create(companyId: string, dto: CreateContractTypeDto): Promise<ContractTypeDto> {
    const row = await this.unique(() =>
      this.prisma.contractType.create({
        data: {
          companyId,
          name: dto.name.trim(),
          party: dto.party,
          flow: dto.flow ?? 'NONE',
          defaultTermMonths: dto.defaultTermMonths ?? null,
          defaultNoticeDays: dto.defaultNoticeDays ?? 30,
          description: trimOrNull(dto.description) ?? null,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      }),
    );
    return this.one(companyId, row.id);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateContractTypeDto,
  ): Promise<ContractTypeDto> {
    const current = await this.get(companyId, id);
    if (dto.party && dto.party !== current.party) {
      if (await this.prisma.contract.count({ where: { typeId: id } })) {
        throw new ConflictException('The party of a type with contracts cannot change');
      }
    }
    await this.unique(() =>
      this.prisma.contractType.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          party: dto.party,
          flow: dto.flow,
          defaultTermMonths: dto.defaultTermMonths,
          defaultNoticeDays: dto.defaultNoticeDays,
          description: trimOrNull(dto.description),
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
      }),
    );
    return this.one(companyId, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.get(companyId, id);
    if (await this.prisma.contract.count({ where: { typeId: id } })) {
      throw new ConflictException('Types with contracts cannot be deleted; deactivate instead');
    }
    await this.prisma.contractType.delete({ where: { id } });
  }

  private async one(companyId: string, id: string) {
    const row = (await this.findAll(companyId)).find((t) => t.id === id);
    if (!row) throw new NotFoundException('Contract type not found');
    return row;
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.contractType.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Contract type not found');
    return row;
  }

  private async unique<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A contract type with this name already exists');
      }
      throw error;
    }
  }
}
