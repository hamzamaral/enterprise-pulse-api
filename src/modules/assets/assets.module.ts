import { Module } from '@nestjs/common';
import { AssetAssignmentsService } from './asset-assignments.service';
import { AssetCountsService } from './asset-counts.service';
import { AssetSettingsService } from './asset-settings.service';
import {
  AssetAssignmentsController,
  AssetCategoriesController,
  AssetCountsController,
  AssetLocationsController,
  AssetsController,
} from './assets.controller';
import { AssetsService } from './assets.service';

/** Fixed assets (demirbaş): asset cards, assignments (zimmet), maintenance, depreciation and counts. */
@Module({
  controllers: [
    AssetCategoriesController,
    AssetLocationsController,
    AssetsController,
    AssetAssignmentsController,
    AssetCountsController,
  ],
  providers: [AssetSettingsService, AssetsService, AssetAssignmentsService, AssetCountsService],
  exports: [AssetAssignmentsService],
})
export class AssetsModule {}
