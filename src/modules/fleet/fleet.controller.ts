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
import {
  AssignVehicleDto,
  CreateFuelEntryDto,
  CreateReadingDto,
  CreateVehicleDocumentDto,
  CreateVehicleDto,
  CreateVehicleServiceDto,
  FleetOptionsDto,
  FleetRunResultDto,
  FleetSummaryDto,
  FuelEntryDto,
  FuelEntryQueryDto,
  ReturnVehicleDto,
  UpdateVehicleDto,
  VehicleDetailDto,
  VehicleDto,
  VehicleQueryDto,
  VehicleStatsQueryDto,
} from './dto/fleet.dto';
import { FleetFuelService } from './fleet-fuel.service';
import { FleetSummaryService } from './fleet-summary.service';
import { VehiclesService } from './vehicles.service';

@ApiTags('Fleet')
@ApiBearerAuth()
@Controller({ path: 'vehicles', version: '1' })
export class VehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly fuel: FleetFuelService,
    private readonly summaryService: FleetSummaryService,
  ) {}

  @Get()
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: [VehicleDto] })
  findAll(@CurrentUser() user: AuthUser, @Query() query: VehicleQueryDto) {
    return this.vehicles.list(user, query);
  }

  @Get('summary')
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: FleetSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.summaryService.summary(companyId);
  }

  /** Vehicles currently assigned to the signed-in employee. */
  @Get('my')
  @ApiOkResponse({ type: [VehicleDto] })
  my(@CurrentUser() user: AuthUser) {
    return this.vehicles.my(user);
  }

  /** Drivers, departments and service partners for the forms. */
  @Get('options')
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: FleetOptionsDto })
  options(@CurrentUser('companyId') companyId: string) {
    return this.vehicles.options(companyId);
  }

  /** Runs the daily document and service reminder job for the current company now. */
  @Post('run')
  @RequirePermissions('fleet:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FleetRunResultDto })
  run(@CurrentUser('companyId') companyId: string) {
    return this.summaryService.run(companyId);
  }

  /** `fleet:read` holders and the current driver can open a vehicle. */
  @Get(':id')
  @ApiOkResponse({ type: VehicleDetailDto })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VehicleStatsQueryDto,
  ) {
    return this.vehicles.findOne(user, id, query.year);
  }

  @Post()
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: VehicleDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: VehicleDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicles.update(user, id, dto);
  }

  /** Only vehicles without history; the others are retired instead. */
  @Delete(':id')
  @RequirePermissions('fleet:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.remove(user, id);
  }

  @Post(':id/assign')
  @RequirePermissions('fleet:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VehicleDetailDto })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignVehicleDto,
  ) {
    return this.vehicles.assign(user, id, dto);
  }

  @Post(':id/return')
  @RequirePermissions('fleet:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VehicleDetailDto })
  returnVehicle(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnVehicleDto,
  ) {
    return this.vehicles.returnVehicle(user, id, dto);
  }

  /** Fleet managers and the current driver. */
  @Post(':id/readings')
  @ApiOkResponse({ type: VehicleDetailDto })
  addReading(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReadingDto,
  ) {
    return this.vehicles.addReading(user, id, dto);
  }

  @Delete(':id/readings/:readingId')
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: VehicleDetailDto })
  removeReading(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('readingId', ParseUUIDPipe) readingId: string,
  ) {
    return this.vehicles.removeReading(user, id, readingId);
  }

  /** A year of fuel entries; `fleet:read` holders and the current driver. */
  @Get(':id/fuel')
  @ApiOkResponse({ type: [FuelEntryDto] })
  fuelEntries(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VehicleStatsQueryDto,
  ) {
    return this.fuel.forVehicle(user, id, query.year);
  }

  /** Fleet managers and the current driver. */
  @Post(':id/fuel')
  @ApiOkResponse({ type: FuelEntryDto })
  addFuel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFuelEntryDto,
  ) {
    return this.fuel.create(user, id, dto);
  }

  @Delete(':id/fuel/:entryId')
  @RequirePermissions('fleet:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFuel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.fuel.remove(user, id, entryId);
  }

  @Post(':id/services')
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: VehicleDetailDto })
  addService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVehicleServiceDto,
  ) {
    return this.vehicles.addService(user, id, dto);
  }

  @Delete(':id/services/:serviceId')
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: VehicleDetailDto })
  removeService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.vehicles.removeService(user, id, serviceId);
  }

  @Post(':id/documents')
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: VehicleDetailDto })
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVehicleDocumentDto,
  ) {
    return this.vehicles.addDocument(user, id, dto);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('fleet:update')
  @ApiOkResponse({ type: VehicleDetailDto })
  removeDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.vehicles.removeDocument(user, id, documentId);
  }
}

@ApiTags('Fleet')
@ApiBearerAuth()
@Controller({ path: 'fuel-entries', version: '1' })
export class FuelEntriesController {
  constructor(private readonly fuel: FleetFuelService) {}

  /** Searches plate, station and driver; sorts by entryDate, amount, liters or odometer. */
  @Get()
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: PaginatedResponseDto(FuelEntryDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: FuelEntryQueryDto) {
    return this.fuel.list(companyId, query);
  }
}
