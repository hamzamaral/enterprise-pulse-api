import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PurchaseRequestStatus } from '@prisma/client';
import { WORKFLOW_EVENTS, type WorkflowFinishedEvent } from '../workflow/workflow.events';
import { PURCHASE_REQUEST_WORKFLOW, PurchaseRequestsService } from './purchase-requests.service';

/** Keeps purchase request status in sync with the approval workflow. */
@Injectable()
export class PurchasingListener {
  constructor(private readonly requests: PurchaseRequestsService) {}

  @OnEvent(WORKFLOW_EVENTS.APPROVED)
  onApproved(event: WorkflowFinishedEvent) {
    return this.apply(event, PurchaseRequestStatus.APPROVED);
  }

  @OnEvent(WORKFLOW_EVENTS.REJECTED)
  onRejected(event: WorkflowFinishedEvent) {
    return this.apply(event, PurchaseRequestStatus.REJECTED);
  }

  @OnEvent(WORKFLOW_EVENTS.CANCELLED)
  onCancelled(event: WorkflowFinishedEvent) {
    return this.apply(event, PurchaseRequestStatus.CANCELLED);
  }

  private async apply(event: WorkflowFinishedEvent, status: PurchaseRequestStatus) {
    if (event.definitionCode !== PURCHASE_REQUEST_WORKFLOW) return;
    await this.requests.decide(event.companyId, event.entityId, status);
  }
}
