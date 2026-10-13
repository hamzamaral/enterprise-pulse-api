import { Module } from '@nestjs/common';
import { CompetenciesService } from './competencies.service';
import {
  CompetenciesController,
  PerformanceGoalsController,
  PerformanceReviewsController,
  ReviewCyclesController,
} from './performance.controller';
import { PerformanceReviewsService } from './performance-reviews.service';
import { ReviewCyclesService } from './review-cycles.service';

/** Performance (performans): competencies, review cycles, goals and reviews. */
@Module({
  controllers: [
    CompetenciesController,
    ReviewCyclesController,
    PerformanceReviewsController,
    PerformanceGoalsController,
  ],
  providers: [CompetenciesService, ReviewCyclesService, PerformanceReviewsService],
})
export class PerformanceModule {}
