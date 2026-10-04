import { beforeEach, describe, expect, it, vi } from "vitest";

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
}));

vi.mock("../wailsjs/runtime/runtime", () => ({
  EventsOn: vi.fn((name: string, callback: (payload: unknown) => void) => {
    listeners.set(name, callback);
  }),
  EventsOff: vi.fn((name: string) => {
    listeners.delete(name);
  }),
}));

import { client } from "./api";

describe("client.chat", () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
  });

  it("forwards Wails chat deltas and removes its request listener", async () => {
    const chat = vi.fn(async (requestID: string) => {
      listeners.get(`chat:delta:${requestID}`)?.("first");
      listeners.get(`chat:delta:${requestID}`)?.(" second");
      return { text: "first second" };
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { go: { main: { Studio: { Chat: chat } } } },
    });

    const received: string[] = [];
    await client.chat(
      [{ role: "user", content: "hello" }],
      { route: "/", screen: "工作台", data: {} },
      (delta) => received.push(delta),
    );

    expect(received).toEqual(["first", " second"]);
    expect(chat).toHaveBeenCalledOnce();
    expect(chat).toHaveBeenCalledWith(
      expect.any(String),
      [{ role: "user", content: "hello" }],
      { route: "/", screen: "工作台", data: {} },
    );
    expect(listeners).toEqual(new Map());
  });

  it("uses the completed response when the provider emits no text delta", async () => {
    const chat = vi.fn(async () => ({ text: "complete response" }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { go: { main: { Studio: { Chat: chat } } } },
    });

    const received: string[] = [];
    await client.chat(
      [{ role: "user", content: "hello" }],
      { route: "/", screen: "工作台", data: {} },
      (delta) => received.push(delta),
    );

    expect(received).toEqual(["complete response"]);
    expect(listeners).toEqual(new Map());
  });
});

describe("client settings refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses separate cached and refresh Wails bindings", async () => {
    const tokenSettings = vi.fn(async () => ({ tokens: [] }));
    const models = vi.fn(async () => ({ models: [] }));
    const refreshTokenSettings = vi.fn(async () => ({ tokens: [] }));
    const refreshModels = vi.fn(async () => ({ models: [] }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        go: {
          main: {
            Studio: {
              TokenSettings: tokenSettings,
              Models: models,
              RefreshTokenSettings: refreshTokenSettings,
              RefreshModels: refreshModels,
            },
          },
        },
      },
    });

    await expect(client.tokenSettings()).resolves.toEqual({ tokens: [] });
    await expect(client.models()).resolves.toEqual({ models: [] });
    await expect(client.refreshTokenSettings()).resolves.toEqual({
      tokens: [],
    });
    await expect(client.refreshModels()).resolves.toEqual({ models: [] });

    expect(tokenSettings).toHaveBeenCalledOnce();
    expect(models).toHaveBeenCalledOnce();
    expect(refreshTokenSettings).toHaveBeenCalledOnce();
    expect(refreshModels).toHaveBeenCalledOnce();
  });
});

describe("client work naming", () => {
  it("forwards title saves and AI suggestions through Wails", async () => {
    const updateWorkTitle = vi.fn(async () => ({ title: "秋日通勤穿搭" }));
    const suggestWorkTitles = vi.fn(async () => ({
      titles: ["秋日通勤穿搭", "轻盈午后", "都市衣橱"],
    }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        go: {
          main: {
            Studio: {
              UpdateWorkTitle: updateWorkTitle,
              SuggestWorkTitles: suggestWorkTitles,
            },
          },
        },
      },
    });

    await expect(
      client.updateWorkTitle({
        kind: "try-on",
        id: "try-1",
        title: "秋日通勤穿搭",
      }),
    ).resolves.toEqual({ title: "秋日通勤穿搭" });
    await expect(client.suggestWorkTitles("try-on", "try-1")).resolves.toEqual({
      titles: ["秋日通勤穿搭", "轻盈午后", "都市衣橱"],
    });
    expect(updateWorkTitle).toHaveBeenCalledWith({
      kind: "try-on",
      id: "try-1",
      title: "秋日通勤穿搭",
    });
    expect(suggestWorkTitles).toHaveBeenCalledWith("try-on", "try-1");
  });
});

describe("client video prompt review", () => {
  it("forwards the selected mode and current prompt to the Wails binding", async () => {
    const review = vi.fn(async () => ({
      score: 88,
      issues: ["补充镜头动作"],
      optimized_prompt: "展示产品细节并保持镜头运动。",
    }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { go: { main: { Studio: { ReviewVideoReplicaPrompt: review } } } },
    });

    await expect(
      client.reviewVideoReplicaPrompt("replica", "展示产品"),
    ).resolves.toMatchObject({ score: 88 });
    expect(review).toHaveBeenCalledWith("replica", "展示产品");
  });
});

describe("client AI video replica", () => {
  it("forwards the selected Seedance generation model", async () => {
    const create = vi.fn(async () => ({ id: "ai-job" }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { go: { main: { Studio: { CreateAIVideoReplica: create } } } },
    });

    await client.createAIVideoReplica({
      source_video_path: "uploads/source.mp4",
      product_paths: [],
      prompt: "展示商品",
      model: "qwen3.8-flash",
      seedance_model: "doubao-seedance-2.0-mini",
      resolution: "480p",
      ratio: "16:9",
      budget: 2,
      avatar_assets: [],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ seedance_model: "doubao-seedance-2.0-mini" }),
    );
  });
});
