import { Module } from '@nestjs/common';
import { AssetAssignmentsService } from './asset-assignments.service';
import { AssetSettingsService } from './asset-settings.service';
import {
  AssetAssignmentsController,
  AssetCategoriesController,
  AssetLocationsController,
  AssetsController,
} from './assets.controller';
import { AssetsService } from './assets.service';

/** Fixed assets (demirbaş): asset cards, assignments (zimmet), maintenance and depreciation. */
@Module({
  controllers: [
    AssetCategoriesController,
    AssetLocationsController,
    AssetsController,
    AssetAssignmentsController,
  ],
  providers: [AssetSettingsService, AssetsService, AssetAssignmentsService],
  exports: [AssetAssignmentsService],
})
export class AssetsModule {}
