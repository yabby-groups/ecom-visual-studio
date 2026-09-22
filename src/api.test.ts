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
    await expect(client.refreshTokenSettings()).resolves.toEqual({ tokens: [] });
    await expect(client.refreshModels()).resolves.toEqual({ models: [] });

    expect(tokenSettings).toHaveBeenCalledOnce();
    expect(models).toHaveBeenCalledOnce();
    expect(refreshTokenSettings).toHaveBeenCalledOnce();
    expect(refreshModels).toHaveBeenCalledOnce();
  });
});
