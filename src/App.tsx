/**
 * Mode app shell: loads projects & library on start, then shows the projects
 * home or the open project's workspace. Global pieces live here: theme,
 * undo/redo hotkeys, automatic scene mapping of new photos, generation
 * preferences, Settings, New project, the Shop modal and toasts.
 */
import { useEffect } from 'react';
import { useStore } from './state/store';
import { ShopModal } from './ui/studio/panels/ShopModal';
import { ErrorBoundary } from './ui/shell/ErrorBoundary';
import { NewProjectModal } from './ui/shell/NewProjectModal';
import { installStudioPrefs } from './ui/shell/prefs';
import { ProjectsHome } from './ui/shell/ProjectsHome';
import { installAutoSceneAnalysis } from './ui/shell/sceneJobs';
import { registerServiceWorker } from './ui/shell/serviceWorker';
import { SettingsModal } from './ui/shell/SettingsModal';
import { ShellStyles } from './ui/shell/ShellStyles';
import { installTheme } from './ui/shell/theme';
import { Toaster } from './ui/shell/Toaster';
import { useUndoRedoHotkeys } from './ui/shell/useHotkeys';
import { Workspace } from './ui/shell/Workspace';

// Apply the stored theme before the first paint.
installTheme();

let started = false;

function startOnce() {
  if (started) return;
  started = true;
  installStudioPrefs();
  installAutoSceneAnalysis();
  registerServiceWorker();
  void useStore.getState().init();
  // The API server may come up after the page (npm run dev) or the network may return.
  window.addEventListener('online', () => void useStore.getState().refreshHealth());
}

export function App() {
  const inProject = useStore((s) => !!s.project);

  useEffect(startOnce, []);
  useUndoRedoHotkeys();

  return (
    <>
      <ShellStyles />
      <ErrorBoundary area="Mode" resetKey={inProject}>
        {inProject ? <Workspace /> : <ProjectsHome />}
      </ErrorBoundary>
      <NewProjectModal />
      <SettingsModal />
      <ShopModal />
      <Toaster />
    </>
  );
}
