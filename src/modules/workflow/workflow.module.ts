import { Module } from '@nestjs/common';
import { WorkflowDefinitionsController, WorkflowInstancesController } from './workflow.controller';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowService } from './workflow.service';

@Module({
  controllers: [WorkflowDefinitionsController, WorkflowInstancesController],
  providers: [WorkflowService, WorkflowDefinitionsService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
