import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { AuditService } from './audit.service';
import { AuditLogDto, AuditLogQueryDto } from './dto/audit-log.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller({ path: 'audit-logs', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOkResponse({ type: PaginatedResponseDto(AuditLogDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: AuditLogQueryDto) {
    return this.audit.findAll(companyId, query);
  }
}
