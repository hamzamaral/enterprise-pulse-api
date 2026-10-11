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
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { CreateUserDto, UpdateUserDto, UserDto, UserQueryDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOkResponse({ type: PaginatedResponseDto(UserDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: UserQueryDto) {
    return this.users.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  @ApiOkResponse({ type: UserDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('users:create')
  @ApiOkResponse({ type: UserDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateUserDto) {
    return this.users.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('users:update')
  @ApiOkResponse({ type: UserDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('users:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.remove(user.companyId, id, user.id);
  }
}
