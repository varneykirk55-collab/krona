import { createContext, useContext } from 'react';
import type {
  Owner,
  Settings,
  Task,
  Project,
  Memory,
  Schedule,
  SystemStatus,
} from '../shared/schemas';
export type Page =
  | 'overview'
  | 'conversation'
  | 'tasks'
  | 'projects'
  | 'memory'
  | 'calls'
  | 'scheduling'
  | 'approvals'
  | 'settings'
  | 'status';
export interface AppContextValue {
  owner: Owner;
  settings: Settings;
  status: SystemStatus | null;
  page: Page;
  navigate: (page: Page) => void;
  notify: (text: string, error?: boolean) => void;
  signOut: () => Promise<void>;
  openTask: (task?: Task) => void;
  openProject: (project?: Project) => void;
  openMemory: (memory?: Memory) => void;
  openSchedule: (schedule?: Schedule) => void;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('Missing application context');
  return context;
}
