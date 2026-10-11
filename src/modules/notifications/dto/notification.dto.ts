import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => String)
  @IsIn(['true', 'false'])
  unreadOnly?: 'true' | 'false';
}

export class SendNotificationDto {
  /** Target users; omit to notify every user of the active company. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds?: string[];

  @IsString()
  @Length(1, 200)
  title: string;

  @IsString()
  @Length(1, 2000)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  link?: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

export class NotificationDto {
  id: string;
  companyId: string | null;
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}

export class UnreadCountDto {
  count: number;
}
