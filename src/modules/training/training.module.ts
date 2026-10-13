import { Module } from '@nestjs/common';
import {
  TrainingCoursesController,
  TrainingEnrollmentsController,
  TrainingSessionsController,
  TrainingsController,
} from './training.controller';
import { TrainingCoursesService } from './training-courses.service';
import { TrainingSessionsService } from './training-sessions.service';
import { TrainingsService } from './trainings.service';

/** Training (eğitim): course catalog, sessions, attendance, certificates and compliance. */
@Module({
  controllers: [
    TrainingCoursesController,
    TrainingSessionsController,
    TrainingEnrollmentsController,
    TrainingsController,
  ],
  providers: [TrainingCoursesService, TrainingSessionsService, TrainingsService],
})
export class TrainingModule {}
