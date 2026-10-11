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
import { BranchesService } from './branches.service';
import { BranchDto, CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('Branches')
@ApiBearerAuth()
@Controller({ path: 'branches', version: '1' })
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions('branches:read')
  @ApiOkResponse({ type: PaginatedResponseDto(BranchDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.branches.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('branches:read')
  @ApiOkResponse({ type: BranchDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.branches.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('branches:create')
  @ApiOkResponse({ type: BranchDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateBranchDto) {
    return this.branches.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('branches:update')
  @ApiOkResponse({ type: BranchDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branches.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('branches:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.branches.remove(companyId, id);
  }
}
