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
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { BomsService } from './boms.service';
import {
  BomDetailDto,
  BomDto,
  BomPlanDto,
  BomPlanQueryDto,
  BomQueryDto,
  CreateBomDto,
  CreatedDocumentDto,
  CreateProductionRecordDto,
  CreateRequirementRequestDto,
  CreateWorkOrderDto,
  ProductionSummaryDto,
  RequirementDto,
  UpdateBomDto,
  UpdateWorkOrderDto,
  WorkOrderDetailDto,
  WorkOrderDto,
  WorkOrderQueryDto,
} from './dto/production.dto';
import { MrpService } from './mrp.service';
import { PRODUCTION_READ, PRODUCTION_RECORD, PRODUCTION_UPDATE } from './production-helpers';
import { WorkOrdersService } from './work-orders.service';

@ApiTags('Production')
@ApiBearerAuth()
@Controller({ path: 'production', version: '1' })
export class ProductionController {
  constructor(
    private readonly boms: BomsService,
    private readonly workOrders: WorkOrdersService,
    private readonly mrp: MrpService,
  ) {}

  @Get('summary')
  @RequirePermissions(PRODUCTION_READ)
  @ApiOkResponse({ type: ProductionSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.mrp.summary(companyId);
  }

  // ---------- MRP ----------

  @Get('requirements')
  @RequirePermissions(PRODUCTION_READ)
  @ApiOkResponse({ type: [RequirementDto] })
  requirements(@CurrentUser('companyId') companyId: string) {
    return this.mrp.requirements(companyId);
  }

  /** Purchase request for the selected shortages. */
  @Post('requirements/purchase-request')
  @RequirePermissions(PRODUCTION_READ)
  @RequireAnyPermission('workflow:start', 'purchasing:create')
  @ApiOkResponse({ type: CreatedDocumentDto })
  createPurchaseRequest(@CurrentUser() user: AuthUser, @Body() dto: CreateRequirementRequestDto) {
    return this.mrp.createPurchaseRequest(user, dto);
  }

  // ---------- Bills of materials ----------

  @Get('boms')
  @RequirePermissions(PRODUCTION_READ)
  @ApiOkResponse({ type: PaginatedResponseDto(BomDto) })
  findBoms(@CurrentUser('companyId') companyId: string, @Query() query: BomQueryDto) {
    return this.boms.findAll(companyId, query);
  }

  @Post('boms')
  @RequirePermissions(PRODUCTION_UPDATE)
  @ApiOkResponse({ type: BomDetailDto })
  createBom(@CurrentUser() user: AuthUser, @Body() dto: CreateBomDto) {
    return this.boms.create(user, dto);
  }

  @Get('boms/:id')
  @RequirePermissions(PRODUCTION_READ)
  @ApiOkResponse({ type: BomDetailDto })
  findBom(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.boms.findOne(companyId, id);
  }

  /** Multi-level net material plan for a quantity. */
  @Get('boms/:id/plan')
  @RequirePermissions(PRODUCTION_READ)
  @ApiOkResponse({ type: BomPlanDto })
  planBom(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BomPlanQueryDto,
  ) {
    return this.boms.plan(companyId, id, query);
  }

  @Patch('boms/:id')
  @RequirePermissions(PRODUCTION_UPDATE)
  @ApiOkResponse({ type: BomDetailDto })
  updateBom(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBomDto,
  ) {
    return this.boms.update(user, id, dto);
  }

  @Delete('boms/:id')
  @RequirePermissions(PRODUCTION_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBom(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.boms.remove(companyId, id);
  }

  // ---------- Work orders ----------

  @Get('work-orders')
  @RequirePermissions(PRODUCTION_READ)
  @ApiOkResponse({ type: PaginatedResponseDto(WorkOrderDto) })
  findWorkOrders(@CurrentUser('companyId') companyId: string, @Query() query: WorkOrderQueryDto) {
    return this.workOrders.findAll(companyId, query);
  }

  @Post('work-orders')
  @RequirePermissions(PRODUCTION_UPDATE)
  @ApiOkResponse({ type: WorkOrderDetailDto })
  createWorkOrder(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkOrderDto) {
    return this.workOrders.create(user, dto);
  }

  @Get('work-orders/:id')
  @RequirePermissions(PRODUCTION_READ)
  @ApiOkResponse({ type: WorkOrderDetailDto })
  findWorkOrder(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workOrders.findOne(companyId, id);
  }

  @Patch('work-orders/:id')
  @RequirePermissions(PRODUCTION_UPDATE)
  @ApiOkResponse({ type: WorkOrderDetailDto })
  updateWorkOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkOrderDto,
  ) {
    return this.workOrders.update(user, id, dto);
  }

  @Post('work-orders/:id/release')
  @RequirePermissions(PRODUCTION_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkOrderDetailDto })
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.release(user, id);
  }

  @Post('work-orders/:id/cancel')
  @RequirePermissions(PRODUCTION_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkOrderDetailDto })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.cancel(user, id);
  }

  /** Closes an order in progress short of its planned quantity. */
  @Post('work-orders/:id/complete')
  @RequirePermissions(PRODUCTION_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkOrderDetailDto })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.complete(user, id);
  }

  /** Üretim fişi: consumes the materials and receives the output. */
  @Post('work-orders/:id/records')
  @RequirePermissions(PRODUCTION_RECORD)
  @ApiOkResponse({ type: WorkOrderDetailDto })
  record(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProductionRecordDto,
  ) {
    return this.workOrders.record(user, id, dto);
  }
}
