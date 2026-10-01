export type AIVideoReplicaControlState = {
  active: boolean;
  waitingForInput: boolean;
  draftLocked: boolean;
  canAnswer: boolean;
  canResume: boolean;
  canTerminate: boolean;
  canPullResult: boolean;
  canRegenerate: boolean;
  canOpenLogs: boolean;
};

const activeStatuses = new Set([
  "queued",
  "preparing",
  "submitting",
  "prompting",
  "generating",
  "running",
  "retrieving",
  "downloading",
  "merging",
]);

const regenerableStatus = (status: string) =>
  status === "ready" ||
  status === "interrupted" ||
  status === "terminated" ||
  status === "succeeded" ||
  status === "not_found" ||
  status.startsWith("failed:");

export function aiVideoReplicaControls({
  status,
  requestID,
  busy = false,
  resuming = false,
  terminating = false,
}: {
  status?: string;
  requestID?: string;
  busy?: boolean;
  resuming?: boolean;
  terminating?: boolean;
}): AIVideoReplicaControlState {
  const active = !!status && activeStatuses.has(status);
  const waitingForInput = status === "waiting_for_input";
  const hasRequest = !!requestID;
  const taskOperation = resuming || terminating;
  const draftLocked = busy || active || waitingForInput || taskOperation;
  const canPullResult =
    hasRequest &&
    !taskOperation &&
    (status === "retrieving" ||
      status === "succeeded" ||
      status === "ready" ||
      !!status?.startsWith("failed:"));

  return {
    active,
    waitingForInput,
    draftLocked,
    canAnswer: waitingForInput && hasRequest && !taskOperation,
    canResume:
      (status === "interrupted" || status === "terminated") &&
      hasRequest &&
      !taskOperation,
    canTerminate: (active || waitingForInput) && status !== "retrieving" && !taskOperation,
    canPullResult,
    canRegenerate: !!status && regenerableStatus(status) && !taskOperation && !busy,
    canOpenLogs: hasRequest && !taskOperation,
  };
}
