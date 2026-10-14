import { Module } from '@nestjs/common';
import { FleetFuelService } from './fleet-fuel.service';
import { FleetSummaryService } from './fleet-summary.service';
import { FuelEntriesController, VehiclesController } from './fleet.controller';
import { FleetProcessor } from './fleet.processor';
import { VehiclesService } from './vehicles.service';

/** Fleet (araç ve filo): vehicles, drivers, odometer, fuel, services and documents. */
@Module({
  controllers: [VehiclesController, FuelEntriesController],
  providers: [VehiclesService, FleetFuelService, FleetSummaryService, FleetProcessor],
})
export class FleetModule {}
