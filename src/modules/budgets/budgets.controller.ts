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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { BudgetEntriesService } from './budget-entries.service';
import { BudgetItemsService } from './budget-items.service';
import { BudgetsService } from './budgets.service';
import {
  BudgetActualDto,
  BudgetActualsQueryDto,
  BudgetDetailDto,
  BudgetEntryDto,
  BudgetEntryQueryDto,
  BudgetItemDto,
  BudgetItemOptionsDto,
  BudgetListDto,
  BudgetListQueryDto,
  BudgetOptionsDto,
  BudgetRunResultDto,
  CreateBudgetDto,
  CreateBudgetEntryDto,
  CreateBudgetItemDto,
  ReopenBudgetDto,
  SaveBudgetPlanDto,
  UpdateBudgetDto,
  UpdateBudgetItemDto,
} from './dto/budget.dto';

@ApiTags('Budgets')
@ApiBearerAuth()
@Controller({ path: 'budgets', version: '1' })
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  /** Budgets of a year with planned versus actual; without `budgets:read` only owned ones. */
  @Get()
  @ApiOkResponse({ type: BudgetListDto })
  list(@CurrentUser() user: AuthUser, @Query() query: BudgetListQueryDto) {
    return this.budgets.list(user, query.year);
  }

  /** Departments and users for the budget form. */
  @Get('options')
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetOptionsDto })
  options(@CurrentUser('companyId') companyId: string) {
    return this.budgets.options(companyId);
  }

  /** Runs the daily overspend check for the current company now. */
  @Post('run')
  @RequirePermissions('budgets:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetRunResultDto })
  run(@CurrentUser('companyId') companyId: string) {
    return this.budgets.run(companyId);
  }

  /** `budgets:read` holders and the owner can open a budget. */
  @Get(':id')
  @ApiOkResponse({ type: BudgetDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.findOne(user, id);
  }

  /** Documents behind an item's actual. */
  @Get(':id/actuals')
  @ApiOkResponse({ type: [BudgetActualDto] })
  actuals(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BudgetActualsQueryDto,
  ) {
    return this.budgets.actualsOf(user, id, query);
  }

  @Post()
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgets.update(user, id, dto);
  }

  @Put(':id/plan')
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetDetailDto })
  savePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveBudgetPlanDto,
  ) {
    return this.budgets.savePlan(user, id, dto);
  }

  @Post(':id/approve')
  @RequirePermissions('budgets:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetDetailDto })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.approve(user, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('budgets:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetDetailDto })
  reopen(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenBudgetDto,
  ) {
    return this.budgets.reopen(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('budgets:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.remove(user, id);
  }
}

@ApiTags('Budgets')
@ApiBearerAuth()
@Controller({ path: 'budget-items', version: '1' })
export class BudgetItemsController {
  constructor(private readonly items: BudgetItemsService) {}

  @Get()
  @RequireAnyPermission('budgets:read', 'budgets:update')
  @ApiOkResponse({ type: [BudgetItemDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.items.findAll(companyId);
  }

  /** Expense and product categories an item can take its actuals from. */
  @Get('options')
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetItemOptionsDto })
  options(@CurrentUser('companyId') companyId: string) {
    return this.items.options(companyId);
  }

  @Post()
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetItemDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateBudgetItemDto) {
    return this.items.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetItemDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetItemDto,
  ) {
    return this.items.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('budgets:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.remove(companyId, id);
  }
}

@ApiTags('Budgets')
@ApiBearerAuth()
@Controller({ path: 'budget-entries', version: '1' })
export class BudgetEntriesController {
  constructor(private readonly entries: BudgetEntriesService) {}

  @Get()
  @RequirePermissions('budgets:read')
  @ApiOkResponse({ type: PaginatedResponseDto(BudgetEntryDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: BudgetEntryQueryDto) {
    return this.entries.findAll(companyId, query);
  }

  @Post()
  @RequirePermissions('budgets:update')
  @ApiOkResponse({ type: BudgetEntryDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBudgetEntryDto) {
    return this.entries.create(user, dto);
  }

  @Delete(':id')
  @RequirePermissions('budgets:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.entries.remove(companyId, id);
  }
}
