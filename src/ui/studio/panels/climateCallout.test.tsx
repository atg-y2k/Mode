// @vitest-environment jsdom
/**
 * The climate callout only shows when the user can act on it: a hardiness
 * zone already rates plant options (no dead end without Claude), and a
 * dismissal is remembered per project across reloads.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HealthResponse } from '../../../../shared/api';
import type { ProjectLocation } from '../../../../shared/types';
import { newProject, useStore } from '../../../state/store';
import { ClimateCallout } from './ui';

const AI_OFF = { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } } as unknown as HealthResponse;
const AI_ON = { ok: true, ai: { enabled: true, model: 'claude' }, imageProvider: { enabled: false, name: null, model: null } } as unknown as HealthResponse;

function show(location: ProjectLocation, health: HealthResponse) {
  const project = { ...newProject('Home'), id: 'prj_climate', location };
  useStore.setState({ project, health });
  return render(<ClimateCallout setting="exterior" />);
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('ClimateCallout', () => {
  it('stays away without Claude when the zone is known (it already rates plants)', () => {
    const { container } = show({ zip: '20817', hardinessZone: '7b', zoneSource: 'zip-table' }, AI_OFF);
    expect(container.textContent).toBe('');
  });

  it('stays away when NOAA frost dates are on file', () => {
    const { container } = show({ zip: '20817', hardinessZone: '7b', site: { frost: { lastSpring: '04-12', firstFall: '10-25' } } as never }, AI_ON);
    expect(container.textContent).toBe('');
  });

  it('with Claude and a zone, offers the climate summary for what the zone lacks', () => {
    show({ zip: '20817', hardinessZone: '7b' }, AI_ON);
    expect(screen.getByText(/already rated for zone 7b/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Look up climate' })).toBeTruthy();
    expect(screen.queryByText(/but not your climate yet/)).toBeNull();
  });

  it('without Claude asks for what the ZIP table could not fill', () => {
    show({ zip: '99999' }, AI_OFF);
    expect(screen.getByText(/Type your hardiness zone in Settings/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open project settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Look up climate' })).toBeNull();
    cleanup();
    show({}, AI_OFF);
    expect(screen.getByRole('button', { name: 'Add ZIP code' })).toBeTruthy();
  });

  it('remembers a dismissal for the project across reloads', () => {
    show({}, AI_OFF);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/Add your ZIP code/)).toBeNull();
    expect(localStorage.getItem('mode.climateCallout.dismissed.prj_climate')).toBe('1');
    cleanup();
    expect(show({}, AI_OFF).container.textContent).toBe('');
  });
});
