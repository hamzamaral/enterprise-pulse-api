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
import { DepartmentsService } from './departments.service';
import {
  CreateEmployeeDto,
  EmployeeDetailDto,
  EmployeeDto,
  EmployeeQueryDto,
  OrgChartNodeDto,
  TerminateEmployeeDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import {
  CreateDepartmentDto,
  CreatePositionDto,
  DepartmentDto,
  PositionDto,
  PositionQueryDto,
  UpdateDepartmentDto,
  UpdatePositionDto,
} from './dto/organization.dto';
import { EmployeesService } from './employees.service';
import { PositionsService } from './positions.service';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller({ path: 'departments', version: '1' })
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions('departments:read')
  @ApiOkResponse({ type: [DepartmentDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.departments.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions('departments:read')
  @ApiOkResponse({ type: DepartmentDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.departments.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('departments:create')
  @ApiOkResponse({ type: DepartmentDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateDepartmentDto) {
    return this.departments.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('departments:update')
  @ApiOkResponse({ type: DepartmentDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('departments:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.departments.remove(companyId, id);
  }
}

@ApiTags('Positions')
@ApiBearerAuth()
@Controller({ path: 'positions', version: '1' })
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @RequirePermissions('positions:read')
  @ApiOkResponse({ type: PaginatedResponseDto(PositionDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PositionQueryDto) {
    return this.positions.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('positions:read')
  @ApiOkResponse({ type: PositionDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.positions.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('positions:create')
  @ApiOkResponse({ type: PositionDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreatePositionDto) {
    return this.positions.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('positions:update')
  @ApiOkResponse({ type: PositionDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePositionDto,
  ) {
    return this.positions.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('positions:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.positions.remove(companyId, id);
  }
}

@ApiTags('Employees')
@ApiBearerAuth()
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions('employees:read')
  @ApiOkResponse({ type: PaginatedResponseDto(EmployeeDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: EmployeeQueryDto) {
    return this.employees.findAll(companyId, query);
  }

  /** Visible to every employee of the company. */
  @Get('org-chart')
  @ApiOkResponse({ type: [OrgChartNodeDto] })
  orgChart(@CurrentUser('companyId') companyId: string) {
    return this.employees.orgChart(companyId);
  }

  @Get('me')
  @ApiOkResponse({ type: EmployeeDetailDto })
  findMine(@CurrentUser() user: AuthUser) {
    return this.employees.findMine(user.companyId, user.id);
  }

  @Get(':id')
  @RequirePermissions('employees:read')
  @ApiOkResponse({ type: EmployeeDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.findOne(companyId, id);
  }

  @Post()
  @RequirePermissions('employees:create')
  @ApiOkResponse({ type: EmployeeDetailDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('employees:update')
  @ApiOkResponse({ type: EmployeeDetailDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(companyId, id, dto);
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('employees:update')
  @ApiOkResponse({ type: EmployeeDetailDto })
  terminate(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateEmployeeDto,
  ) {
    return this.employees.terminate(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employees:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.remove(companyId, id);
  }
}
