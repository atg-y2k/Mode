// @vitest-environment jsdom
/**
 * Settings with no keys: the Images tab says plainly that image keys are
 * optional (no variable names there), and "AI & server" is the one place
 * with the steps to add a Claude key — no filled-in placeholder keys to
 * paste by mistake.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../state/store';
import { SettingsModal } from './SettingsModal';
import { closeSettings, openSettings } from './shellUI';

const NO_KEYS = { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null }, imageProviders: [] };

beforeEach(() => {
  useStore.setState({ project: null, health: NO_KEYS });
});
afterEach(() => {
  act(() => closeSettings());
  cleanup();
});

describe('Settings without keys', () => {
  it('Images: image keys are optional, with a way to the steps', () => {
    act(() => openSettings('generation'));
    render(<SettingsModal />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Automatic renders need an OpenAI or Gemini key (optional)');
    expect(dialog.textContent).not.toMatch(/OPENAI_API_KEY|GEMINI_API_KEY|\.env/);
    fireEvent.click(screen.getByRole('button', { name: 'How to add a key' }));
    expect(screen.getByRole('heading', { name: 'Add a Claude key' })).toBeTruthy();
  });

  it('AI & server: how to add a Claude key, with nothing to paste but the key itself', () => {
    act(() => openSettings('server'));
    render(<SettingsModal />);
    expect(screen.getByRole('heading', { name: 'Add a Claude key' })).toBeTruthy();
    const steps = screen.getByRole('heading', { name: 'Add a Claude key' }).closest('section')!;
    expect(steps.textContent).toContain('Paste your key right after ANTHROPIC_API_KEY=');
    expect(steps.textContent).toMatch(/cp -n \.env\.example \.env|copy \.env\.example \.env/);
    // No placeholder values to copy along with the key.
    expect(steps.textContent).not.toMatch(/sk-|IMAGE_PROVIDER=|OPENAI_API_KEY=|GEMINI_API_KEY=/);
    expect(screen.queryByText(/Turn on AI features/)).toBeNull();
  });

  it('AI & server with Claude on but no image key: the optional image key steps', () => {
    useStore.setState({ health: { ...NO_KEYS, ai: { enabled: true, model: 'claude' } } });
    act(() => openSettings('server'));
    render(<SettingsModal />);
    const steps = screen.getByRole('heading', { name: 'Add an image key (optional)' }).closest('section')!;
    expect(steps.textContent).toContain('OPENAI_API_KEY=');
    expect(steps.textContent).not.toContain('ANTHROPIC_API_KEY');
  });
});
