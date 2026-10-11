import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class UploadFileDto {
  /** Owning record type, e.g. "Asset". */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;
}

export class FileQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}

export class FileDto {
  id: string;
  companyId: string;
  originalName: string;
  mimeType: string;
  size: number;
  entityType: string | null;
  entityId: string | null;
  uploadedById: string | null;
  createdAt: Date;
}

export class DownloadUrlDto {
  url: string;
  expiresIn: number;
}
