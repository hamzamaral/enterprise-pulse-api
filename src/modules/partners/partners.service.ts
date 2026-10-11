import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PartnerType, Prisma, type BusinessPartner } from '@prisma/client';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService, type PrismaTx } from '../../infrastructure/prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import type {
  CreatePartnerDto,
  PartnerDto,
  PartnerQueryDto,
  UpdatePartnerDto,
} from './dto/partner.dto';
import { PartnerLedgerService } from './partner-ledger.service';

const SORTABLE = ['code', 'title', 'createdAt'] as const;

/** Types that may appear on documents of each side. */
export const CUSTOMER_TYPES = [PartnerType.CUSTOMER, PartnerType.BOTH];
export const SUPPLIER_TYPES = [PartnerType.SUPPLIER, PartnerType.BOTH];

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly ledger: PartnerLedgerService,
  ) {}

  async findAll(companyId: string, query: PartnerQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.BusinessPartnerWhereInput = {
      companyId,
      deletedAt: null,
      isActive: query.isActive,
      ...(query.type && {
        type: { in: query.type === PartnerType.BOTH ? [PartnerType.BOTH] : [query.type, 'BOTH'] },
      }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { taxNumber: { startsWith: search } },
          { city: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.businessPartner.findMany({
        where,
        orderBy: [toOrderBy(query, SORTABLE, 'code'), { code: 'asc' }],
        ...toPageArgs(query),
      }),
      this.prisma.businessPartner.count({ where }),
    ]);
    const balances = await this.ledger.balances(
      companyId,
      rows.map((r) => r.id),
    );
    return paginated(
      rows.map((row) => toDto(row, balances.get(row.id)!)),
      total,
      query,
    );
  }

  async findOne(companyId: string, id: string): Promise<PartnerDto> {
    const row = await this.get(companyId, id);
    return toDto(row, await this.ledger.balance(companyId, id));
  }

  async create(companyId: string, dto: CreatePartnerDto): Promise<PartnerDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const code = dto.code?.trim() || (await this.numbering.next(companyId, 'PARTNER', tx));
      await this.assertCodeFree(tx, companyId, code);
      return tx.businessPartner.create({
        data: { ...dto, code, companyId, title: dto.title.trim() },
      });
    });
    return toDto(row, new Prisma.Decimal(0));
  }

  async update(companyId: string, id: string, dto: UpdatePartnerDto): Promise<PartnerDto> {
    const existing = await this.get(companyId, id);
    if (dto.code && dto.code !== existing.code) {
      await this.assertCodeFree(this.prisma, companyId, dto.code);
    }
    await this.prisma.businessPartner.update({ where: { id }, data: dto });
    return this.findOne(companyId, id);
  }

  /** Soft delete; the ledger history stays intact. */
  async remove(companyId: string, id: string): Promise<void> {
    await this.get(companyId, id);
    await this.prisma.businessPartner.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Loads an active partner for a new document and checks it may act on that side
   * (customers on sales documents, suppliers on purchasing documents).
   */
  async getForDocument(
    tx: PrismaTx,
    companyId: string,
    id: string,
    allowed: PartnerType[],
  ): Promise<BusinessPartner> {
    const partner = await tx.businessPartner.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    if (!partner.isActive) throw new ConflictException(`${partner.title} is inactive`);
    if (!allowed.includes(partner.type)) {
      throw new ConflictException(
        `${partner.title} is not a ${allowed.includes(PartnerType.CUSTOMER) ? 'customer' : 'supplier'}`,
      );
    }
    return partner;
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.businessPartner.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Partner not found');
    return row;
  }

  private async assertCodeFree(client: PrismaTx | PrismaService, companyId: string, code: string) {
    const taken = await client.businessPartner.count({ where: { companyId, code } });
    if (taken) throw new ConflictException(`Partner code ${code} is already in use`);
  }
}

function toDto(row: BusinessPartner, balance: Prisma.Decimal): PartnerDto {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    type: row.type,
    taxNumber: row.taxNumber,
    taxOffice: row.taxOffice,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    contactName: row.contactName,
    paymentTermDays: row.paymentTermDays,
    currencyCode: row.currencyCode,
    creditLimit: row.creditLimit?.toFixed(2) ?? null,
    notes: row.notes,
    isActive: row.isActive,
    balance: balance.toFixed(2),
    createdAt: row.createdAt,
  };
}
