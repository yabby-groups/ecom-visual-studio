import { create } from 'zustand'
import { client } from './api'
import type { Project, Template, User } from './types'

type AppState = {
  user: User | null
  projects: Project[]
  templates: Template[]
  initializing: boolean
  initialize: () => Promise<void>
  refreshProjects: () => Promise<void>
  refreshTemplates: () => Promise<void>
  setUser: (user: User | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  projects: [],
  templates: [],
  initializing: true,
  async initialize() {
    try {
      const { user } = await client.me()
      if (!user) return set({ user: null, initializing: false })
      const [projects, templates] = await Promise.all([client.projects(), client.templates()])
      set({ user, projects, templates, initializing: false })
    } catch {
      set({ user: null, initializing: false })
    }
  },
  async refreshProjects() { set({ projects: await client.projects() }) },
  async refreshTemplates() { set({ templates: await client.templates() }) },
  setUser(user) { set({ user, projects: [], templates: [] }) },
}))
