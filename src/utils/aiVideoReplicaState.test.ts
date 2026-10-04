import { describe, expect, it } from "vitest";
import { aiVideoReplicaControls } from "./aiVideoReplicaState";

describe("aiVideoReplicaControls", () => {
  it("locks the editor while a remote task is active", () => {
    expect(
      aiVideoReplicaControls({ status: "generating", requestID: "remote-1" }),
    ).toMatchObject({
      active: true,
      draftLocked: true,
      canTerminate: true,
      canResume: false,
      canRegenerate: false,
    });
  });

  it("keeps legacy remote running states locked", () => {
    expect(
      aiVideoReplicaControls({ status: "running", requestID: "remote-1" }),
    ).toMatchObject({
      active: true,
      draftLocked: true,
      canTerminate: true,
      canRegenerate: false,
    });
  });

  it("only allows an answer while waiting for input", () => {
    expect(
      aiVideoReplicaControls({
        status: "waiting_for_input",
        requestID: "remote-1",
      }),
    ).toMatchObject({
      waitingForInput: true,
      draftLocked: true,
      canAnswer: true,
      canResume: false,
      canTerminate: true,
      canRegenerate: false,
    });
  });

  it("enables continuation for interrupted and terminated tasks", () => {
    expect(
      aiVideoReplicaControls({ status: "interrupted", requestID: "remote-1" }),
    ).toMatchObject({ canResume: true, canRegenerate: true });
    expect(
      aiVideoReplicaControls({
        status: "failed: provider unavailable",
        requestID: "remote-1",
      }),
    ).toMatchObject({ canResume: false, canRegenerate: true });
    expect(
      aiVideoReplicaControls({ status: "terminated", requestID: "remote-1" }),
    ).toMatchObject({ canResume: true, canRegenerate: true });
    expect(
      aiVideoReplicaControls({ status: "ready", requestID: "remote-1" }),
    ).toMatchObject({ canResume: true, canRegenerate: true });
    expect(
      aiVideoReplicaControls({
        status: "ready",
        requestID: "remote-1",
      }),
    ).toMatchObject({ canResume: true, draftLocked: false });
    expect(
      aiVideoReplicaControls({ status: "succeeded", requestID: "remote-1" }),
    ).toMatchObject({ canResume: false, canRegenerate: true });
  });

  it("does not expose remote controls without a request id", () => {
    expect(
      aiVideoReplicaControls({ status: "failed: local upload" }),
    ).toMatchObject({
      canResume: false,
      canOpenLogs: false,
    });
  });

  it("disables conflicting task controls while a mutation is running", () => {
    expect(
      aiVideoReplicaControls({
        status: "waiting_for_input",
        requestID: "remote-1",
        resuming: true,
      }),
    ).toMatchObject({
      canAnswer: false,
      canOpenLogs: false,
      draftLocked: true,
    });
  });
});
