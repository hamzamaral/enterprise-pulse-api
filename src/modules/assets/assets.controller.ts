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
import { AssetAssignmentsService } from './asset-assignments.service';
import { AssetSettingsService } from './asset-settings.service';
import { AssetsService } from './assets.service';
import {
  AssetCategoryDto,
  AssetDetailDto,
  AssetDto,
  AssetLocationDto,
  AssetQueryDto,
  AssignAssetDto,
  AssignmentDocumentDto,
  AssignmentDto,
  AssignmentQueryDto,
  CompleteMaintenanceDto,
  CreateAssetCategoryDto,
  CreateAssetDto,
  CreateAssetLocationDto,
  CreateMaintenanceDto,
  MaintenanceDto,
  RetireAssetDto,
  ReturnAssetDto,
  UpdateAssetCategoryDto,
  UpdateAssetDto,
  UpdateAssetLocationDto,
} from './dto/asset.dto';

@ApiTags('Assets')
@ApiBearerAuth()
@Controller({ path: 'asset-categories', version: '1' })
export class AssetCategoriesController {
  constructor(private readonly settings: AssetSettingsService) {}

  @Get()
  @RequirePermissions('assets:read')
  @ApiOkResponse({ type: [AssetCategoryDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.settings.findCategories(companyId);
  }

  @Post()
  @RequirePermissions('assets:update')
  @ApiOkResponse({ type: AssetCategoryDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateAssetCategoryDto) {
    return this.settings.createCategory(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('assets:update')
  @ApiOkResponse({ type: AssetCategoryDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetCategoryDto,
  ) {
    return this.settings.updateCategory(companyId, id, dto);
  }
}

@ApiTags('Assets')
@ApiBearerAuth()
@Controller({ path: 'asset-locations', version: '1' })
export class AssetLocationsController {
  constructor(private readonly settings: AssetSettingsService) {}

  @Get()
  @RequirePermissions('assets:read')
  @ApiOkResponse({ type: [AssetLocationDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.settings.findLocations(companyId);
  }

  @Post()
  @RequirePermissions('assets:update')
  @ApiOkResponse({ type: AssetLocationDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateAssetLocationDto) {
    return this.settings.createLocation(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('assets:update')
  @ApiOkResponse({ type: AssetLocationDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetLocationDto,
  ) {
    return this.settings.updateLocation(companyId, id, dto);
  }
}

@ApiTags('Assets')
@ApiBearerAuth()
@Controller({ path: 'assets', version: '1' })
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly assignments: AssetAssignmentsService,
  ) {}

  @Get()
  @RequirePermissions('assets:read')
  @ApiOkResponse({ type: PaginatedResponseDto(AssetDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: AssetQueryDto) {
    return this.assets.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('assets:read')
  @ApiOkResponse({ type: AssetDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('assets:create')
  @ApiOkResponse({ type: AssetDetailDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateAssetDto) {
    return this.assets.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('assets:update')
  @ApiOkResponse({ type: AssetDetailDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assets.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('assets:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.remove(companyId, id);
  }

  @Post(':id/retire')
  @RequirePermissions('assets:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssetDetailDto })
  retire(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetireAssetDto,
  ) {
    return this.assets.retire(companyId, id, dto);
  }

  @Post(':id/assign')
  @RequirePermissions('assets:assign')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssignmentDto })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
  ) {
    return this.assignments.assign(user, id, dto);
  }

  @Post(':id/return')
  @RequirePermissions('assets:assign')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssignmentDto })
  returnAsset(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAssetDto,
  ) {
    return this.assignments.return(user, id, dto);
  }

  @Post(':id/transfer')
  @RequirePermissions('assets:assign')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssignmentDto })
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
  ) {
    return this.assignments.transfer(user, id, dto);
  }

  @Get(':id/maintenances')
  @RequirePermissions('assets:read')
  @ApiOkResponse({ type: [MaintenanceDto] })
  findMaintenances(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.findMaintenances(companyId, id);
  }

  @Post(':id/maintenances')
  @RequirePermissions('assets:update')
  @ApiOkResponse({ type: MaintenanceDto })
  createMaintenance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMaintenanceDto,
  ) {
    return this.assets.createMaintenance(user, id, dto);
  }

  @Post(':id/maintenances/:maintenanceId/complete')
  @RequirePermissions('assets:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MaintenanceDto })
  completeMaintenance(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('maintenanceId', ParseUUIDPipe) maintenanceId: string,
    @Body() dto: CompleteMaintenanceDto,
  ) {
    return this.assets.completeMaintenance(companyId, id, maintenanceId, dto);
  }
}

@ApiTags('Assets')
@ApiBearerAuth()
@Controller({ path: 'asset-assignments', version: '1' })
export class AssetAssignmentsController {
  constructor(private readonly assignments: AssetAssignmentsService) {}

  @Get()
  @RequirePermissions('assets:read')
  @ApiOkResponse({ type: PaginatedResponseDto(AssignmentDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: AssignmentQueryDto) {
    return this.assignments.findAll(companyId, query);
  }

  /** Assets held by the current user's employee record. */
  @Get('mine')
  @ApiOkResponse({ type: [AssignmentDto] })
  findMine(@CurrentUser() user: AuthUser) {
    return this.assignments.findMine(user);
  }

  /** Hand-over form data; visible to the holder or with `assets:read`. */
  @Get(':id')
  @ApiOkResponse({ type: AssignmentDocumentDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.findDocument(user, id);
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssignmentDocumentDto })
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.acknowledge(user, id);
  }
}
