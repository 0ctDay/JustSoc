export type AlertAgentInvestigationRecord = {
  taskId: string;
  alertId: string;
  alertIndex: string;
  alertTitle: string;
  status: string;
  runnerType: string;
  externalTaskId?: string;
  triggeredByUserKey?: string;
  requestJson: Record<string, unknown>;
  resultJson?: Record<string, unknown> | null;
  progressJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export async function getLatestInvestigation(_alertId: string): Promise<AlertAgentInvestigationRecord | null> {
  return null;
}

export async function createInvestigationForAlert(): Promise<never> {
  throw new Error('Agent 调查功能已下线');
}
