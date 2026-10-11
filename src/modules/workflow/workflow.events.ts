export const WORKFLOW_EVENTS = {
  APPROVED: 'workflow.approved',
  REJECTED: 'workflow.rejected',
  CANCELLED: 'workflow.cancelled',
} as const;

/**
 * Business modules listen to these events to update their own documents, e.g.
 * `@OnEvent(WORKFLOW_EVENTS.APPROVED)` in the purchasing module marks the request approved.
 */
export interface WorkflowFinishedEvent {
  instanceId: string;
  companyId: string;
  definitionCode: string;
  entityType: string;
  entityId: string;
  actorId: string;
}
