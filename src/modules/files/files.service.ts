import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginated, toPageArgs } from '../../common/pagination/paginate';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import type { DownloadUrlDto, FileDto, FileQueryDto, UploadFileDto } from './dto/file.dto';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const DOWNLOAD_URL_TTL_SECONDS = 300;

const publicSelect = {
  id: true,
  companyId: true,
  originalName: true,
  mimeType: true,
  size: true,
  entityType: true,
  entityId: true,
  uploadedById: true,
  createdAt: true,
} satisfies Prisma.FileObjectSelect;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    companyId: string,
    userId: string,
    file: Express.Multer.File,
    dto: UploadFileDto,
  ): Promise<FileDto> {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`File type ${file.mimetype} is not allowed`);
    }

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const storageKey = `${companyId}/${now.getFullYear()}/${month}/${randomUUID()}${extname(file.originalname).toLowerCase()}`;
    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    return this.prisma.fileObject.create({
      data: {
        companyId,
        storageKey,
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        mimeType: file.mimetype,
        size: file.size,
        entityType: dto.entityType,
        entityId: dto.entityId,
        uploadedById: userId,
      },
      select: publicSelect,
    });
  }

  async findAll(companyId: string, query: FileQueryDto) {
    const where: Prisma.FileObjectWhereInput = {
      companyId,
      deletedAt: null,
      entityType: query.entityType,
      entityId: query.entityId,
      ...(query.search ? { originalName: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.fileObject.findMany({
        where,
        select: publicSelect,
        orderBy: { createdAt: 'desc' },
        ...toPageArgs(query),
      }),
      this.prisma.fileObject.count({ where }),
    ]);
    return paginated(data, total, query);
  }

  async getDownloadUrl(companyId: string, id: string): Promise<DownloadUrlDto> {
    const file = await this.getFile(companyId, id);
    const url = await this.storage.getDownloadUrl(
      file.storageKey,
      file.originalName,
      DOWNLOAD_URL_TTL_SECONDS,
    );
    return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
  }

  async remove(companyId: string, id: string): Promise<void> {
    const file = await this.getFile(companyId, id);
    await this.prisma.fileObject.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.storage.delete(file.storageKey);
  }

  private async getFile(companyId: string, id: string) {
    const file = await this.prisma.fileObject.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    return file;
  }
}
