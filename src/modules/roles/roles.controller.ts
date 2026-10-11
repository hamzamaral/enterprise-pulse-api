import {
  Body,
  Controller,
  Delete,
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
import { PaginatedResponseDto, PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { CreateRoleDto, PermissionDto, RoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles:read')
  @ApiOkResponse({ type: PaginatedResponseDto(RoleDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.roles.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('roles:read')
  @ApiOkResponse({ type: RoleDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('roles:create')
  @ApiOkResponse({ type: RoleDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateRoleDto) {
    return this.roles.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('roles:update')
  @ApiOkResponse({ type: RoleDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('roles:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(companyId, id);
  }
}

@ApiTags('Roles')
@ApiBearerAuth()
@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles:read')
  @ApiOkResponse({ type: [PermissionDto] })
  findAll() {
    return this.roles.findPermissions();
  }
}
