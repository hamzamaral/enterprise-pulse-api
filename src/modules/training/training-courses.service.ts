import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TrainingEnrollmentStatus, TrainingSessionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CreateTrainingCourseDto,
  TrainingCourseDto,
  TrainingCourseQueryDto,
  UpdateTrainingCourseDto,
} from './dto/training.dto';
import { trimOrNull } from './training-support';

/** Eğitim kataloğu. */
@Injectable()
export class TrainingCoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: TrainingCourseQueryDto): Promise<TrainingCourseDto[]> {
    const search = query.search?.trim();
    const rows = await this.prisma.trainingCourse.findMany({
      where: {
        companyId,
        category: query.category,
        isActive: query.active === undefined ? undefined : query.active === 'true',
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                { provider: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isMandatory: 'desc' }, { title: 'asc' }],
    });
    return this.withStats(rows);
  }

  async findOne(companyId: string, id: string): Promise<TrainingCourseDto> {
    const [dto] = await this.withStats([await this.get(companyId, id)]);
    return dto;
  }

  async create(companyId: string, dto: CreateTrainingCourseDto): Promise<TrainingCourseDto> {
    try {
      const row = await this.prisma.trainingCourse.create({
        data: {
          companyId,
          code: dto.code.trim().toUpperCase(),
          title: dto.title.trim(),
          category: dto.category,
          format: dto.format,
          durationHours: dto.durationHours,
          provider: trimOrNull(dto.provider),
          description: trimOrNull(dto.description),
          isMandatory: dto.isMandatory ?? false,
          validityMonths: dto.validityMonths ?? null,
          isActive: dto.isActive ?? true,
        },
      });
      return this.findOne(companyId, row.id);
    } catch (error) {
      throw duplicate(error);
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTrainingCourseDto,
  ): Promise<TrainingCourseDto> {
    await this.get(companyId, id);
    try {
      await this.prisma.trainingCourse.update({
        where: { id },
        data: {
          code: dto.code?.trim().toUpperCase(),
          title: dto.title?.trim(),
          category: dto.category,
          format: dto.format,
          durationHours: dto.durationHours,
          provider: trimOrNull(dto.provider),
          description: trimOrNull(dto.description),
          isMandatory: dto.isMandatory,
          validityMonths: dto.validityMonths,
          isActive: dto.isActive,
        },
      });
    } catch (error) {
      throw duplicate(error);
    }
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.get(companyId, id);
    const sessions = await this.prisma.trainingSession.count({ where: { courseId: id } });
    if (sessions) {
      throw new ConflictException('The course has sessions; deactivate it instead');
    }
    await this.prisma.trainingCourse.delete({ where: { id } });
  }

  private async get(companyId: string, id: string) {
    const row = await this.prisma.trainingCourse.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Training course not found');
    return row;
  }

  private async withStats(
    rows: Prisma.TrainingCourseGetPayload<object>[],
  ): Promise<TrainingCourseDto[]> {
    const ids = rows.map((r) => r.id);
    const now = new Date();
    const [sessions, upcoming, attended] = await Promise.all([
      this.prisma.trainingSession.groupBy({
        by: ['courseId'],
        where: { courseId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.trainingSession.groupBy({
        by: ['courseId'],
        where: {
          courseId: { in: ids },
          status: TrainingSessionStatus.PLANNED,
          startsAt: { gt: now },
        },
        _count: { _all: true },
      }),
      this.prisma.trainingEnrollment.findMany({
        where: {
          status: TrainingEnrollmentStatus.ATTENDED,
          session: { courseId: { in: ids } },
        },
        select: { employeeId: true, session: { select: { courseId: true } } },
      }),
    ]);
    const count = (groups: { courseId: string; _count: { _all: number } }[]) =>
      new Map(groups.map((g) => [g.courseId, g._count._all]));
    const sessionCounts = count(sessions);
    const upcomingCounts = count(upcoming);
    const people = new Map<string, Set<string>>();
    for (const a of attended) {
      const set = people.get(a.session.courseId) ?? new Set<string>();
      set.add(a.employeeId);
      people.set(a.session.courseId, set);
    }
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      category: row.category,
      format: row.format,
      durationHours: row.durationHours.toFixed(1),
      provider: row.provider,
      description: row.description,
      isMandatory: row.isMandatory,
      validityMonths: row.validityMonths,
      isActive: row.isActive,
      sessionCount: sessionCounts.get(row.id) ?? 0,
      upcomingCount: upcomingCounts.get(row.id) ?? 0,
      attendedCount: people.get(row.id)?.size ?? 0,
    }));
  }
}

function duplicate(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('A course with this code already exists');
  }
  return error;
}
