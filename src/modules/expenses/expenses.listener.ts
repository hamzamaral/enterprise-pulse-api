import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WORKFLOW_EVENTS, type WorkflowFinishedEvent } from '../workflow/workflow.events';
import { EXPENSE_WORKFLOW, ExpenseReportsService } from './expense-reports.service';

/** Keeps expense report status in sync with the approval workflow. */
@Injectable()
export class ExpensesListener {
  constructor(private readonly reports: ExpenseReportsService) {}

  @OnEvent(WORKFLOW_EVENTS.APPROVED)
  onApproved(event: WorkflowFinishedEvent) {
    return this.apply(event, 'APPROVED');
  }

  @OnEvent(WORKFLOW_EVENTS.REJECTED)
  onRejected(event: WorkflowFinishedEvent) {
    return this.apply(event, 'REJECTED');
  }

  /** A withdrawn approval sends the report back to draft. */
  @OnEvent(WORKFLOW_EVENTS.CANCELLED)
  onCancelled(event: WorkflowFinishedEvent) {
    return this.apply(event, 'CANCELLED');
  }

  private async apply(
    event: WorkflowFinishedEvent,
    outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  ) {
    if (event.definitionCode !== EXPENSE_WORKFLOW) return;
    await this.reports.decide(event.companyId, event.entityId, outcome);
  }
}
