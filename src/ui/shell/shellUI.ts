/**
 * Shell-only UI state shared between the top bar, sidebars, the projects home
 * and anything that wants to open Settings (e.g. a panel prompting for a ZIP
 * code): `openSettings('project')`.
 * The spaces sidebar toggle is remembered per device; the right panel always
 * starts open (a hidden panel is easy to miss on the next visit).
 */
import { create } from 'zustand';
import { useStore } from '../../state/store';

export type SettingsTab = 'project' | 'generation' | 'appearance' | 'server' | 'storage';

interface ShellUIState {
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  /** Desktop: spaces sidebar collapsed. */
  sidebarCollapsed: boolean;
  /** Desktop: right panel content collapsed (tab rail stays). This session only. */
  panelCollapsed: boolean;
  newProjectOpen: boolean;
  addSpaceOpen: boolean;
  /** Group shown first in the Add space modal. */
  addSpaceKind: 'interior' | 'exterior' | null;
}

const SIDEBAR_KEY = 'mode.layout.sidebarCollapsed';

function readFlag(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // ignore: layout preference only
  }
}

export const useShellUI = create<ShellUIState>()(() => ({
  settingsOpen: false,
  settingsTab: 'appearance',
  sidebarCollapsed: readFlag(SIDEBAR_KEY),
  panelCollapsed: false,
  newProjectOpen: false,
  addSpaceOpen: false,
  addSpaceKind: null,
}));

/** Opens the Settings modal (default tab: Project when a project is open). */
export function openSettings(tab?: SettingsTab): void {
  const inProject = !!useStore.getState().project;
  const fallback: SettingsTab = inProject ? 'project' : 'appearance';
  useShellUI.setState({ settingsOpen: true, settingsTab: tab ?? fallback });
}

export function closeSettings(): void {
  useShellUI.setState({ settingsOpen: false });
}

export function setSettingsTab(tab: SettingsTab): void {
  useShellUI.setState({ settingsTab: tab });
}

export function setSidebarCollapsed(collapsed: boolean): void {
  writeFlag(SIDEBAR_KEY, collapsed);
  useShellUI.setState({ sidebarCollapsed: collapsed });
}

export function setPanelCollapsed(collapsed: boolean): void {
  useShellUI.setState({ panelCollapsed: collapsed });
}

export function openNewProject(): void {
  useShellUI.setState({ newProjectOpen: true });
}

export function closeNewProject(): void {
  useShellUI.setState({ newProjectOpen: false });
}

export function openAddSpace(kind: 'interior' | 'exterior' | null = null): void {
  useShellUI.setState({ addSpaceOpen: true, addSpaceKind: kind });
}

export function closeAddSpace(): void {
  useShellUI.setState({ addSpaceOpen: false });
}
