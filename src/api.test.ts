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
    await client.chat([{ role: "user", content: "hello" }], (delta) => received.push(delta));

    expect(received).toEqual(["first", " second"]);
    expect(chat).toHaveBeenCalledOnce();
    expect(listeners).toEqual(new Map());
  });

  it("uses the completed response when the provider emits no text delta", async () => {
    const chat = vi.fn(async () => ({ text: "complete response" }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { go: { main: { Studio: { Chat: chat } } } },
    });

    const received: string[] = [];
    await client.chat([{ role: "user", content: "hello" }], (delta) => received.push(delta));

    expect(received).toEqual(["complete response"]);
    expect(listeners).toEqual(new Map());
  });
});
