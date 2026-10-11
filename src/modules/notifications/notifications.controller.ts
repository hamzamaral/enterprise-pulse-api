import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  NotificationDto,
  NotificationQueryDto,
  SendNotificationDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOkResponse({ type: PaginatedResponseDto(NotificationDto) })
  findMine(@CurrentUser('id') userId: string, @Query() query: NotificationQueryDto) {
    return this.notifications.findMine(userId, query);
  }

  @Get('unread-count')
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser('id') userId: string) {
    return this.notifications.unreadCount(userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  markAllRead(@CurrentUser('id') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(userId, id);
  }

  /** Company-wide or targeted announcement. */
  @Post('send')
  @RequirePermissions('notifications:send')
  @HttpCode(HttpStatus.NO_CONTENT)
  send(@CurrentUser('companyId') companyId: string, @Body() dto: SendNotificationDto) {
    return this.notifications.send(companyId, dto);
  }
}
