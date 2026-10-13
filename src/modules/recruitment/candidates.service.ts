import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { hasPermission } from '../../common/auth/has-permission';
import { paginated, toOrderBy, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { DownloadUrlDto } from '../files/dto/file.dto';
import { FilesService } from '../files/files.service';
import type {
  CandidateDetailDto,
  CandidateDto,
  CandidateQueryDto,
  CreateCandidateDto,
  UpdateCandidateDto,
} from './dto/recruitment.dto';
import { ACTIVE_STAGES } from './recruitment-math';
import { baseCurrency, fullName, money, trimOrNull } from './recruitment-support';

export const CV_ENTITY = 'Candidate';
const SORTABLE = ['firstName', 'lastName', 'email', 'createdAt'] as const;

const listInclude = {
  applications: { select: { stage: true, appliedAt: true } },
} satisfies Prisma.CandidateInclude;

const detailInclude = {
  cvFile: { select: { originalName: true } },
  referredBy: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  applications: {
    include: { posting: { select: { number: true, title: true } } },
    orderBy: { appliedAt: 'desc' },
  },
} satisfies Prisma.CandidateInclude;

type ListRow = Prisma.CandidateGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.CandidateGetPayload<{ include: typeof detailInclude }>;

/** Candidates (aday havuzu): one record per e-mail, reused across postings. */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async findAll(companyId: string, query: CandidateQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.CandidateWhereInput = {
      companyId,
      source: query.source,
      ...(query.postingId ? { applications: { some: { postingId: query.postingId } } } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { currentTitle: { contains: search, mode: 'insensitive' } },
              { currentCompany: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.candidate.findMany({
        where,
        include: listInclude,
        orderBy: [toOrderBy(query, SORTABLE, 'createdAt'), { createdAt: 'desc' }],
        ...toPageArgs(query),
      }),
      this.prisma.candidate.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  async findOne(user: AuthUser, id: string): Promise<CandidateDetailDto> {
    const row = await this.prisma.candidate.findFirst({
      where: { id, companyId: user.companyId },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Candidate not found');
    const currency = await baseCurrency(this.prisma, user.companyId);
    return toDetailDto(row, currency, user);
  }

  async create(user: AuthUser, dto: CreateCandidateDto): Promise<CandidateDetailDto> {
    const email = dto.email.trim().toLowerCase();
    await this.assertUniqueEmail(user.companyId, email);
    await this.assertReferrer(user.companyId, dto.referredById);
    const row = await this.prisma.candidate.create({
      data: {
        companyId: user.companyId,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        phone: trimOrNull(dto.phone),
        city: trimOrNull(dto.city),
        source: dto.source,
        currentTitle: trimOrNull(dto.currentTitle),
        currentCompany: trimOrNull(dto.currentCompany),
        linkedinUrl: trimOrNull(dto.linkedinUrl),
        expectedSalary: dto.expectedSalary ?? null,
        notes: trimOrNull(dto.notes),
        referredById: dto.referredById ?? null,
        createdById: user.id,
      },
    });
    return this.findOne(user, row.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateCandidateDto): Promise<CandidateDetailDto> {
    const current = await this.get(user.companyId, id);
    const email = dto.email?.trim().toLowerCase();
    if (email && email !== current.email) await this.assertUniqueEmail(user.companyId, email);
    await this.assertReferrer(user.companyId, dto.referredById);
    await this.prisma.candidate.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        email,
        phone: trimOrNull(dto.phone),
        city: trimOrNull(dto.city),
        source: dto.source,
        currentTitle: trimOrNull(dto.currentTitle),
        currentCompany: trimOrNull(dto.currentCompany),
        linkedinUrl: trimOrNull(dto.linkedinUrl),
        expectedSalary: dto.expectedSalary,
        notes: trimOrNull(dto.notes),
        referredById: dto.referredById,
      },
    });
    return this.findOne(user, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const row = await this.get(companyId, id);
    const applications = await this.prisma.jobApplication.count({ where: { candidateId: id } });
    if (applications > 0) {
      throw new ConflictException('Candidates with applications cannot be deleted');
    }
    await this.prisma.candidate.delete({ where: { id } });
    if (row.cvFileId) await this.files.remove(companyId, row.cvFileId);
  }

  /** Replaces the candidate's CV. */
  async uploadCv(
    user: AuthUser,
    id: string,
    file: Express.Multer.File,
  ): Promise<CandidateDetailDto> {
    const row = await this.get(user.companyId, id);
    const uploaded = await this.files.upload(user.companyId, user.id, file, {
      entityType: CV_ENTITY,
      entityId: id,
    });
    await this.prisma.candidate.update({ where: { id }, data: { cvFileId: uploaded.id } });
    if (row.cvFileId) await this.files.remove(user.companyId, row.cvFileId);
    return this.findOne(user, id);
  }

  async removeCv(user: AuthUser, id: string): Promise<CandidateDetailDto> {
    const row = await this.get(user.companyId, id);
    if (row.cvFileId) {
      await this.prisma.candidate.update({ where: { id }, data: { cvFileId: null } });
      await this.files.remove(user.companyId, row.cvFileId);
    }
    return this.findOne(user, id);
  }

  async cvUrl(companyId: string, id: string): Promise<DownloadUrlDto> {
    const row = await this.get(companyId, id);
    if (!row.cvFileId) throw new NotFoundException('The candidate has no CV');
    return this.files.getDownloadUrl(companyId, row.cvFileId);
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.candidate.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Candidate not found');
    return row;
  }

  private async assertUniqueEmail(companyId: string, email: string) {
    const exists = await this.prisma.candidate.count({ where: { companyId, email } });
    if (exists) throw new ConflictException('A candidate with this e-mail already exists');
  }

  private async assertReferrer(companyId: string, employeeId: string | null | undefined) {
    if (!employeeId) return;
    const exists = await this.prisma.employee.count({
      where: { id: employeeId, companyId, deletedAt: null, status: EmployeeStatus.ACTIVE },
    });
    if (!exists) throw new BadRequestException('Referrer must be an active employee');
  }
}

function toDto(row: ListRow): CandidateDto {
  const last = row.applications.reduce<Date | null>(
    (latest, a) => (!latest || a.appliedAt > latest ? a.appliedAt : latest),
    null,
  );
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: fullName(row),
    email: row.email,
    phone: row.phone,
    city: row.city,
    source: row.source,
    currentTitle: row.currentTitle,
    currentCompany: row.currentCompany,
    expectedSalary: money(row.expectedSalary),
    hasCv: !!row.cvFileId,
    applicationCount: row.applications.length,
    activeApplicationCount: row.applications.filter((a) => ACTIVE_STAGES.includes(a.stage)).length,
    lastAppliedAt: last?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetailDto(row: DetailRow, currencyCode: string, user: AuthUser): CandidateDetailDto {
  return {
    ...toDto(row),
    linkedinUrl: row.linkedinUrl,
    notes: row.notes,
    referredById: row.referredById,
    referredByName: row.referredBy ? fullName(row.referredBy) : null,
    cvFileName: row.cvFile?.originalName ?? null,
    currencyCode,
    createdByName: fullName(row.createdBy),
    applications: row.applications.map((a) => ({
      id: a.id,
      postingId: a.postingId,
      postingNumber: a.posting.number,
      postingTitle: a.posting.title,
      stage: a.stage,
      rating: a.rating,
      appliedAt: a.appliedAt.toISOString(),
      stageChangedAt: a.stageChangedAt.toISOString(),
    })),
    canEdit: hasPermission(user, 'recruitment:update'),
    canDelete: row.applications.length === 0 && hasPermission(user, 'recruitment:delete'),
  };
}
