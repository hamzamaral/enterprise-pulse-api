import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  VehicleDocumentType,
  VehicleFuelType,
  VehicleOdometerSource,
  VehicleOwnership,
  VehicleServiceType,
  VehicleStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import {
  DOCUMENT_STATES,
  SERVICE_STATES,
  type DocumentState,
  type ServiceState,
} from '../fleet-math';

const MAX_KM = 9_999_999;

// ---------- Vehicles ----------

export class CreateVehicleDto {
  /** Turkish plate in any spacing, stored as "34 ABC 123". */
  @IsString()
  @Length(5, 15)
  plate: string;

  @IsString()
  @Length(2, 50)
  brand: string;

  @IsString()
  @Length(1, 80)
  model: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  modelYear?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string | null;

  /** Şasi numarası. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vin?: string | null;

  @IsEnum(VehicleFuelType)
  @ApiProperty({ enum: VehicleFuelType, enumName: 'VehicleFuelType' })
  fuelType: VehicleFuelType;

  @IsOptional()
  @IsEnum(VehicleOwnership)
  @ApiProperty({ enum: VehicleOwnership, enumName: 'VehicleOwnership', required: false })
  ownership?: VehicleOwnership;

  /** End of the lease or rental. */
  @IsOptional()
  @IsDateString({ strict: true })
  contractEndsOn?: string | null;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  /** Starting odometer of a new vehicle; later changes come from readings. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometer?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(100000)
  serviceIntervalKm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  serviceIntervalMonths?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  nextServiceKm?: number | null;

  @IsOptional()
  @IsDateString({ strict: true })
  nextServiceDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateVehicleDto extends PartialType(
  OmitType(CreateVehicleDto, ['odometer'] as const),
) {
  /** RETIRED closes the open assignment; ACTIVE brings a retired vehicle back. */
  @IsOptional()
  @IsEnum(VehicleStatus)
  @ApiProperty({ enum: VehicleStatus, enumName: 'VehicleStatus', required: false })
  status?: VehicleStatus;
}

export class VehicleQueryDto {
  @IsOptional()
  @IsEnum(VehicleStatus)
  @ApiProperty({ enum: VehicleStatus, enumName: 'VehicleStatus', required: false })
  status?: VehicleStatus;
}

export class VehicleDocumentStatusDto {
  @ApiProperty({ enum: VehicleDocumentType, enumName: 'VehicleDocumentType' })
  type: VehicleDocumentType;
  @ApiProperty({ enum: DOCUMENT_STATES, enumName: 'VehicleDocumentState' })
  state: DocumentState;
  endDate: string | null;
  daysLeft: number | null;
}

export class VehicleDriverDto {
  assignmentId: string;
  employeeId: string;
  name: string;
  since: string;
}

export class VehicleDto {
  id: string;
  plate: string;
  brand: string;
  model: string;
  modelYear: number | null;
  color: string | null;
  vin: string | null;
  @ApiProperty({ enum: VehicleFuelType, enumName: 'VehicleFuelType' })
  fuelType: VehicleFuelType;
  @ApiProperty({ enum: VehicleOwnership, enumName: 'VehicleOwnership' })
  ownership: VehicleOwnership;
  contractEndsOn: string | null;
  departmentId: string | null;
  departmentName: string | null;
  @ApiProperty({ enum: VehicleStatus, enumName: 'VehicleStatus' })
  status: VehicleStatus;
  odometer: number;
  serviceIntervalKm: number | null;
  serviceIntervalMonths: number | null;
  nextServiceKm: number | null;
  nextServiceDate: string | null;
  @ApiProperty({ enum: SERVICE_STATES, enumName: 'VehicleServiceState', nullable: true })
  serviceState: ServiceState | null;
  driver: VehicleDriverDto | null;
  /** Inspection, traffic insurance, casco and emission; MISSING when never recorded. */
  documents: VehicleDocumentStatusDto[];
  /** Expired / missing required documents and overdue services. */
  alertCount: number;
  /** Expiring documents and services due soon. */
  warningCount: number;
  /** Fuel, service and document costs this year. */
  yearCost: string;
  /** L/100 km over this year's full tanks. */
  consumption: string | null;
  retiredOn: string | null;
}

export class VehicleAssignmentDto {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentName: string | null;
  startDate: string;
  endDate: string | null;
  startOdometer: number;
  endOdometer: number | null;
  note: string | null;
  createdByName: string;
}

export class VehicleReadingDto {
  id: string;
  readingDate: string;
  odometer: number;
  @ApiProperty({ enum: VehicleOdometerSource, enumName: 'VehicleOdometerSource' })
  source: VehicleOdometerSource;
  note: string | null;
  createdByName: string | null;
}

export class VehicleServiceDto {
  id: string;
  @ApiProperty({ enum: VehicleServiceType, enumName: 'VehicleServiceType' })
  type: VehicleServiceType;
  serviceDate: string;
  odometer: number | null;
  partnerId: string | null;
  partnerName: string | null;
  description: string;
  cost: string;
  createdByName: string;
}

export class VehicleDocumentDto {
  id: string;
  @ApiProperty({ enum: VehicleDocumentType, enumName: 'VehicleDocumentType' })
  type: VehicleDocumentType;
  startDate: string | null;
  endDate: string;
  provider: string | null;
  policyNumber: string | null;
  cost: string;
  note: string | null;
  /** The latest document of its type. */
  isCurrent: boolean;
  createdByName: string;
}

export class VehicleMonthDto {
  /** 1–12 */
  month: number;
  km: number;
  liters: string;
  fuelCost: string;
  serviceCost: string;
  documentCost: string;
}

export class VehicleYearStatsDto {
  year: number;
  km: number;
  liters: string;
  fuelCost: string;
  serviceCost: string;
  documentCost: string;
  totalCost: string;
  costPerKm: string | null;
  consumption: string | null;
  months: VehicleMonthDto[];
}

export class VehicleDetailDto extends VehicleDto {
  currencyCode: string;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  assignments: VehicleAssignmentDto[];
  readings: VehicleReadingDto[];
  services: VehicleServiceDto[];
  allDocuments: VehicleDocumentDto[];
  stats: VehicleYearStatsDto;
  /** Holds `fleet:update`. */
  canManage: boolean;
  /** The current driver; may add fuel and odometer readings. */
  isDriver: boolean;
  canDelete: boolean;
}

export class VehicleStatsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class FleetOptionDto {
  id: string;
  name: string;
}

export class FleetDriverOptionDto extends FleetOptionDto {
  departmentName: string | null;
  /** Plate of the vehicle the employee already drives. */
  currentPlate: string | null;
}

export class FleetOptionsDto {
  drivers: FleetDriverOptionDto[];
  departments: FleetOptionDto[];
  /** Suppliers for the service workshop. */
  partners: FleetOptionDto[];
}

// ---------- Assignments and readings ----------

export class AssignVehicleDto {
  @IsUUID()
  employeeId: string;

  @IsDateString({ strict: true })
  startDate: string;

  /** Defaults to the vehicle's current odometer. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometer?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ReturnVehicleDto {
  @IsDateString({ strict: true })
  endDate: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometer?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CreateReadingDto {
  @IsDateString({ strict: true })
  readingDate: string;

  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometer: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

// ---------- Fuel ----------

export class CreateFuelEntryDto {
  @IsDateString({ strict: true })
  entryDate: string;

  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometer: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(2000)
  liters: number;

  /** Company currency. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  amount: number;

  @IsOptional()
  @IsBoolean()
  fullTank?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  station?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class FuelEntryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

export class FuelEntryDto {
  id: string;
  vehicleId: string;
  plate: string;
  entryDate: string;
  odometer: number;
  liters: string;
  amount: string;
  /** amount / liters */
  unitPrice: string;
  fullTank: boolean;
  station: string | null;
  employeeId: string | null;
  driverName: string | null;
  distance: number | null;
  consumption: string | null;
  note: string | null;
  createdByName: string;
  createdAt: string;
}

// ---------- Services and documents ----------

export class CreateVehicleServiceDto {
  @IsEnum(VehicleServiceType)
  @ApiProperty({ enum: VehicleServiceType, enumName: 'VehicleServiceType' })
  type: VehicleServiceType;

  @IsDateString({ strict: true })
  serviceDate: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  odometer?: number | null;

  @IsOptional()
  @IsUUID()
  partnerId?: string | null;

  @IsString()
  @Length(3, 500)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  cost: number;

  /** Overrides the next service the intervals would give (periodic services only). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_KM)
  nextServiceKm?: number | null;

  @IsOptional()
  @IsDateString({ strict: true })
  nextServiceDate?: string | null;
}

export class CreateVehicleDocumentDto {
  @IsEnum(VehicleDocumentType)
  @ApiProperty({ enum: VehicleDocumentType, enumName: 'VehicleDocumentType' })
  type: VehicleDocumentType;

  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string | null;

  @IsDateString({ strict: true })
  endDate: string;

  /** Insurer or inspection station. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  policyNumber?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

// ---------- Summary ----------

export const FLEET_ALERT_KINDS = [
  ...Object.values(VehicleDocumentType),
  'SERVICE',
  'CONTRACT',
] as const;
export type FleetAlertKind = (typeof FLEET_ALERT_KINDS)[number];

export const FLEET_ALERT_STATES = [
  'MISSING',
  'EXPIRED',
  'EXPIRING',
  'OVERDUE',
  'DUE_SOON',
] as const;
export type FleetAlertState = (typeof FLEET_ALERT_STATES)[number];

export class FleetAlertDto {
  vehicleId: string;
  plate: string;
  @ApiProperty({ enum: FLEET_ALERT_KINDS, enumName: 'FleetAlertKind' })
  kind: FleetAlertKind;
  @ApiProperty({ enum: FLEET_ALERT_STATES, enumName: 'FleetAlertState' })
  state: FleetAlertState;
  date: string | null;
  daysLeft: number | null;
  /** km to the next service; negative when overdue. */
  kmLeft: number | null;
}

export class FleetMonthDto {
  /** YYYY-MM */
  month: string;
  fuelCost: string;
  serviceCost: string;
  documentCost: string;
  liters: string;
}

export class FleetSummaryDto {
  currencyCode: string;
  total: number;
  active: number;
  inService: number;
  assigned: number;
  unassigned: number;
  /** Fuel, service and document costs this year. */
  yearCost: string;
  yearFuelCost: string;
  yearKm: number;
  costPerKm: string | null;
  /** Average of the vehicles' L/100 km this year. */
  consumption: string | null;
  alerts: FleetAlertDto[];
  /** The last 12 months, oldest first. */
  months: FleetMonthDto[];
}

export class FleetRunResultDto {
  vehicles: number;
  reminders: number;
}
