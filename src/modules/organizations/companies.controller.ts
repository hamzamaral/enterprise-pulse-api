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
import { PaginatedResponseDto, PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { CompaniesService } from './companies.service';
import { CompanyDto, CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@ApiTags('Companies')
@ApiBearerAuth()
@Controller({ path: 'companies', version: '1' })
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions('companies:read')
  @ApiOkResponse({ type: PaginatedResponseDto(CompanyDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.companies.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('companies:read')
  @ApiOkResponse({ type: CompanyDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.findOne(id);
  }

  @Post()
  @RequirePermissions('companies:create')
  @ApiOkResponse({ type: CompanyDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('companies:update')
  @ApiOkResponse({ type: CompanyDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('companies:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.remove(id);
  }
}
