import { create } from "zustand";
import { client } from "./api";
import type { Project, Template, User } from "./types";

type AppState = {
  user: User | null;
  projects: Project[];
  templates: Template[];
  initializing: boolean;
  initialize: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  setUser: (user: User | null) => void;
};

export const useAppStore = create<AppState>((set) => ({
  user: null,
  projects: [],
  templates: [],
  initializing: true,
  async initialize() {
    const [session, projectResult, templateResult] = await Promise.allSettled([
      client.me(),
      client.projects(),
      client.templates(),
    ]);
    set({
      user: session.status === "fulfilled" ? session.value.user : null,
      projects: projectResult.status === "fulfilled" ? projectResult.value : [],
      templates:
        templateResult.status === "fulfilled" ? templateResult.value : [],
      initializing: false,
    });
  },
  async refreshProjects() {
    set({ projects: await client.projects() });
  },
  async refreshTemplates() {
    set({ templates: await client.templates() });
  },
  setUser(user) {
    set({ user });
  },
}));
