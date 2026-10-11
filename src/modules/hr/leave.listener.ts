import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LeaveRequestStatus } from '@prisma/client';
import { WORKFLOW_EVENTS, type WorkflowFinishedEvent } from '../workflow/workflow.events';
import { LEAVE_WORKFLOW_CODE } from './leave.constants';
import { LeaveRequestsService } from './leave-requests.service';

/** Keeps leave request status and balances in sync with the approval workflow. */
@Injectable()
export class LeaveListener {
  constructor(private readonly requests: LeaveRequestsService) {}

  @OnEvent(WORKFLOW_EVENTS.APPROVED)
  onApproved(event: WorkflowFinishedEvent) {
    return this.apply(event, LeaveRequestStatus.APPROVED);
  }

  @OnEvent(WORKFLOW_EVENTS.REJECTED)
  onRejected(event: WorkflowFinishedEvent) {
    return this.apply(event, LeaveRequestStatus.REJECTED);
  }

  @OnEvent(WORKFLOW_EVENTS.CANCELLED)
  onCancelled(event: WorkflowFinishedEvent) {
    return this.apply(event, LeaveRequestStatus.CANCELLED);
  }

  private async apply(event: WorkflowFinishedEvent, status: LeaveRequestStatus) {
    if (event.definitionCode !== LEAVE_WORKFLOW_CODE) return;
    await this.requests.decide(event.companyId, event.entityId, status);
  }
}
