import { describe, expect, it } from "vitest";
import type { VideoReplicaJob } from "../types";
import {
  filterVideoWorks,
  libraryTabs,
  videoReplicaPath,
} from "./libraryWorks";

const regular = { id: "regular", task_type: "reference" } as VideoReplicaJob;
const ai = { id: "ai", task_type: "ai_replica" } as VideoReplicaJob;

describe("library works", () => {
  it("provides stable tabs with distinct new-work paths", () => {
    expect(libraryTabs.map((tab) => [tab.id, tab.createPath])).toEqual([
      ["images", "/new"],
      ["try-on", "/try-on"],
      ["video-replica", "/video-replica"],
      ["ai-video-replica", "/ai-video-replica"],
    ]);
  });

  it("separates normal and AI video jobs with their own detail URLs", () => {
    expect(filterVideoWorks([regular, ai], "video-replica")).toEqual([regular]);
    expect(filterVideoWorks([regular, ai], "ai-video-replica")).toEqual([ai]);
    expect(videoReplicaPath(regular)).toBe("/video-replica/regular");
    expect(videoReplicaPath(ai)).toBe("/ai-video-replica/ai");
  });
});
