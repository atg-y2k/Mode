// @vitest-environment jsdom
/**
 * The review step must be hosted whatever pane a phone shows: a run started
 * from the Design pane (StudioView unmounted) would otherwise skip the
 * review (SPEC 5.2) — and in API mode spend image calls unreviewed.
 * Panes and heavy children are stubbed; the real ReviewModal registers itself.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./hooks', () => ({ useIsDesktop: () => false, isDesktopViewport: () => false }));
vi.mock('../editor/EditorView', () => ({ EditorView: () => null }));
vi.mock('../studio/StudioView', () => ({ StudioView: () => null }));
vi.mock('./SpacesSidebar', () => ({ SpacesSidebar: () => null }));
vi.mock('./RightPanel', () => ({ DesktopRightPanel: () => null, MobileRightPanel: () => <div>Design pane</div> }));
vi.mock('./TopBar', () => ({ TopBar: () => null }));
vi.mock('./MobileNav', () => ({ MobileNav: () => null }));
vi.mock('./PhotoPicker', () => ({ PhotoPicker: () => null }));
vi.mock('./AddSpaceModal', () => ({ AddSpaceModal: () => null }));
vi.mock('./WorkspaceEmpty', () => ({ AddPhotosDropZone: () => null, NoSpaceYet: () => null }));

import { useStore } from '../../state/store';
import { reviewAvailable } from '../studio/handoff/review';
import { Workspace } from './Workspace';

describe('review host', () => {
  it('is registered while a phone shows the Design pane (StudioView not mounted)', async () => {
    useStore.setState({ view: { ...useStore.getState().view, mobilePane: 'panel' } });
    expect(reviewAvailable()).toBe(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Workspace />));
    expect(host.textContent).toContain('Design pane');
    expect(reviewAvailable()).toBe(true);
    await act(async () => root.unmount());
    expect(reviewAvailable()).toBe(false);
  });
});
