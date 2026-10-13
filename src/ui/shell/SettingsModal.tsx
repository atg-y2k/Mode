/**
 * Settings (tabs):
 * - Project: name, ZIP, hardiness zone, "Look up climate" (AI) → climate
 *   card, overall style, location notes.
 * - Image generation: default provider (from /api/health) and quality
 *   (store.studio.provider / quality, remembered on this device).
 * - Appearance: System / Light / Dark.
 * - AI & server: status, how to enable keys, server access token.
 * - Storage & data: usage, persistence, back up / import / delete project.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  Check,
  CloudRain,
  Database,
  Eye,
  EyeOff,
  FolderInput,
  Archive,
  KeyRound,
  Leaf,
  Loader2,
  MapPin,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Server,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { ImageProviderId } from '../../../shared/api';
import type { ClimateProfile, ProjectLocation } from '../../../shared/types';
import { ARCHITECTURAL_STYLES, DESIGN_THEMES } from '../../assets/design';
import { fetchClimate } from '../../lib/studio';
import * as db from '../../state/persistence';
import { useStore, type StudioState } from '../../state/store';
import { Badge, Button, Field, Modal, Segmented, TextArea, TextInput, cn } from '../common';
import { aiLevel, aiSummary, imageProvidersOf } from './AiStatus';
import { errorText, formatBytes, isValidZip, normalizeZone, relativeTime } from './format';
import { readApiToken, saveApiToken } from './prefs';
import { closeSettings, setSettingsTab, useShellUI, type SettingsTab } from './shellUI';
import { useTheme, type ThemePref } from './theme';

const TABS: { id: SettingsTab; label: string; icon: LucideIcon; needsProject?: boolean }[] = [
  { id: 'project', label: 'Project', icon: MapPin, needsProject: true },
  { id: 'generation', label: 'Images', icon: Wand2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'server', label: 'AI & server', icon: Server },
  { id: 'storage', label: 'Storage', icon: Database },
];

export function SettingsModal() {
  const open = useShellUI((s) => s.settingsOpen);
  return open ? <SettingsDialog /> : null;
}

function SettingsDialog() {
  const hasProject = useStore((s) => !!s.project);
  const requested = useShellUI((s) => s.settingsTab);
  const tabs = TABS.filter((t) => !t.needsProject || hasProject);
  const tab = tabs.some((t) => t.id === requested) ? requested : tabs[0].id;

  return (
    <Modal open onClose={closeSettings} title="Settings" size="lg">
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 mb-4 border-b border-line bg-surface px-3">
        <div role="tablist" aria-label="Settings sections" className="scroll-thin flex gap-1 overflow-x-auto py-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              // Focused first when the dialog opens (rather than a text field, which would pop up a phone keyboard).
              data-autofocus={t.id === tab || undefined}
              onClick={() => setSettingsTab(t.id)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                t.id === tab ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
              )}
            >
              <t.icon className="size-4" aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" className="flex flex-col gap-6 pb-2">
        {tab === 'project' && <ProjectTab />}
        {tab === 'generation' && <GenerationTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'server' && <ServerTab />}
        {tab === 'storage' && <StorageTab />}
      </div>
    </Modal>
  );
}

function Group({ title, description, children, action }: { title: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

function ProjectTab() {
  const project = useStore((s) => s.project);
  const aiEnabled = useStore((s) => !!s.health?.ai.enabled);
  const [name, setName] = useState(project?.name ?? '');
  const [zip, setZip] = useState(project?.location.zip ?? '');
  const [zone, setZone] = useState(project?.location.hardinessZone ?? '');
  const [zoneError, setZoneError] = useState(false);
  const [looking, setLooking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const styles = useMemo(() => {
    try {
      return [...new Set([...ARCHITECTURAL_STYLES.map((s) => s.name), ...DESIGN_THEMES.map((t) => t.name)])].sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!project) return null;
  const location = project.location;
  const setLocation = (patch: Partial<ProjectLocation>) => {
    const cur = useStore.getState().project?.location ?? {};
    useStore.getState().updateProjectInfo({ location: { ...cur, ...patch } });
  };
  const zipOk = isValidZip(zip);
  const climate = location.climate;

  const lookUp = async () => {
    if (looking) return;
    const z = zip.trim();
    const normalizedZone = normalizeZone(zone);
    if (!z && !normalizedZone) {
      useStore.getState().notify('Enter a ZIP code (or a hardiness zone) first.', 'info');
      return;
    }
    setLooking(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const projectId = project.id;
    try {
      const result = await fetchClimate({ zip: z || null, hardinessZone: normalizedZone, notes: location.notes?.trim() || null }, controller.signal);
      if (useStore.getState().project?.id !== projectId) return;
      setLocation({ climate: result, hardinessZone: result.hardinessZone });
      setZone(result.hardinessZone);
      useStore.getState().notify(`Climate updated — USDA zone ${result.hardinessZone}.`, 'success');
    } catch (err) {
      if (!controller.signal.aborted) useStore.getState().notify(`Couldn't look up the climate: ${errorText(err)}`, 'error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLooking(false);
    }
  };

  return (
    <>
      <Group title="Project">
        <Field label="Name">
          <TextInput
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) useStore.getState().updateProjectInfo({ name: e.target.value.trim() });
            }}
            onBlur={() => !name.trim() && setName(project.name)}
          />
        </Field>
        <Field label="Overall style" hint="A direction for the whole house, e.g. “modern farmhouse” or “drought-tolerant cottage garden”.">
          <TextInput
            value={project.style ?? ''}
            list="mode-settings-styles"
            maxLength={120}
            placeholder="Optional"
            onChange={(e) => useStore.getState().updateProjectInfo({ style: e.target.value || undefined })}
          />
          <datalist id="mode-settings-styles">
            {styles.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      </Group>

      <Group
        title="Location & climate"
        description="Plant ideas are checked against your hardiness zone, frost dates and rainfall so they actually thrive where you live."
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,8rem)_1fr] sm:items-end">
          <Field label="ZIP code" hint={!zipOk ? <span className="text-danger">5-digit US ZIP</span> : undefined}>
            <TextInput
              value={zip}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="e.g. 20817"
              aria-invalid={!zipOk}
              className={cn(!zipOk && 'border-danger! focus:ring-danger/25!')}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d-]/g, '').slice(0, 10);
                setZip(v);
                if (isValidZip(v)) setLocation({ zip: v.trim() || undefined });
              }}
            />
          </Field>
          <Field label="Hardiness zone" hint={zoneError ? <span className="text-danger">e.g. 7a</span> : undefined}>
            <TextInput
              value={zone}
              placeholder="e.g. 7a"
              maxLength={8}
              aria-invalid={zoneError}
              className={cn(zoneError && 'border-danger! focus:ring-danger/25!')}
              onChange={(e) => {
                setZone(e.target.value);
                setZoneError(false);
              }}
              onBlur={() => {
                const v = zone.trim();
                if (!v) {
                  setLocation({ hardinessZone: undefined });
                  return;
                }
                const n = normalizeZone(v);
                if (!n) return setZoneError(true);
                setZone(n);
                if (n !== location.hardinessZone) setLocation({ hardinessZone: n });
              }}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Button
              icon={<Sparkles className="size-4" />}
              loading={looking}
              disabled={!aiEnabled || !zipOk}
              onClick={() => void lookUp()}
              title={aiEnabled ? 'Ask AI for your climate profile' : 'Needs AI — see AI & server'}
            >
              {climate ? 'Refresh climate' : 'Look up climate'}
            </Button>
          </div>
        </div>
        {!aiEnabled && (
          <p className="text-xs text-muted">Climate lookup needs AI on the server. You can still type your hardiness zone — it’s used for plant feasibility.</p>
        )}
        {climate && <ClimateCard climate={climate} onRemove={() => setLocation({ climate: undefined })} />}
        <Field label="Notes about the property" hint="Shared with the AI: microclimate, HOA rules, deer, how you use the yard and rooms…">
          <TextArea
            value={location.notes ?? ''}
            rows={3}
            maxLength={1000}
            placeholder="e.g. North-facing front, clay soil, deer at night, HOA requires neutral exterior colors."
            onChange={(e) => setLocation({ notes: e.target.value || undefined })}
          />
        </Field>
      </Group>
    </>
  );
}

function ClimateCard({ climate, onRemove }: { climate: ClimateProfile; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2/60 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-accent text-accent-fg">
          <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80">Zone</span>
          <span className="font-display text-xl leading-none">{climate.hardinessZone}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-text">{climate.summary}</p>
          <p className="mt-1 text-[11px] text-subtle">
            {climate.source === 'ai' ? 'From AI knowledge — verify locally' : 'Entered by you'} · updated {relativeTime(climate.updatedAt)}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-xs min-[420px]:grid-cols-3">
        <ClimateFact icon={Snowflake} label="Last frost" value={climate.lastFrost} />
        <ClimateFact icon={CalendarDays} label="First frost" value={climate.firstFrost} />
        <ClimateFact icon={CloudRain} label="Rainfall" value={climate.annualRainfallIn ? `${Math.round(climate.annualRainfallIn)} in / year` : undefined} />
      </dl>
      {climate.notes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {climate.notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <Leaf className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
          Remove climate profile
        </Button>
      </div>
    </div>
  );
}

function ClimateFact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | undefined }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2">
      <Icon className="size-3.5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-wider text-subtle">{label}</dt>
        <dd className="truncate font-medium text-text">{value || '—'}</dd>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

const QUALITY_HELP: Record<StudioState['quality'], string> = {
  draft: 'Fastest and cheapest — good for exploring many ideas.',
  standard: 'Balanced detail and speed — the everyday choice.',
  high: 'Most detail and realism; slower and costs more per image.',
};

function GenerationTab() {
  const health = useStore((s) => s.health);
  const provider = useStore((s) => s.studio.provider);
  const quality = useStore((s) => s.studio.quality);
  const providers = imageProvidersOf(health);
  const def = providers.find((p) => p.isDefault) ?? providers[0];
  const setStudio = useStore.getState().setStudio;
  const unknownChoice = provider && !providers.some((p) => p.id === provider);

  return (
    <>
      <Group title="Image provider" description="Which model renders photoreal variations. You can also switch per run in the Studio.">
        {providers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
            {health === null ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Checking the server…
              </span>
            ) : (
              <>
                No image provider is configured on this server. Add <Code>OPENAI_API_KEY</Code> or <Code>GEMINI_API_KEY</Code> to{' '}
                <Code>.env</Code> and restart — see <em>AI &amp; server</em>.
              </>
            )}
          </div>
        ) : (
          <div role="radiogroup" aria-label="Image provider" className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              selected={!provider || !!unknownChoice}
              onSelect={() => setStudio({ provider: null })}
              title="Automatic"
              subtitle={def ? `Server default: ${def.name}` : 'Server default'}
            />
            {providers.map((p) => (
              <ChoiceCard
                key={p.id}
                selected={provider === p.id}
                onSelect={() => setStudio({ provider: p.id as ImageProviderId })}
                title={p.name}
                subtitle={p.model || undefined}
                badge={p.isDefault ? 'Default' : undefined}
              />
            ))}
          </div>
        )}
      </Group>
      <Group title="Quality" description={QUALITY_HELP[quality]}>
        <Segmented<StudioState['quality']>
          value={quality}
          onChange={(q) => setStudio({ quality: q })}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'standard', label: 'Standard' },
            { value: 'high', label: 'High' },
          ]}
          className="w-full sm:w-auto"
        />
      </Group>
      <p className="flex items-center gap-2 text-xs text-subtle">
        <Check className="size-3.5" aria-hidden /> Remembered on this device for every project.
      </p>
    </>
  );
}

function ChoiceCard({
  selected,
  onSelect,
  title,
  subtitle,
  badge,
  icon,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn('text-sm font-medium', selected ? 'text-accent' : 'text-text')}>{title}</span>
          {badge && <Badge>{badge}</Badge>}
        </span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span>}
        {children}
      </span>
      <span
        className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong')}
        aria-hidden
      >
        {selected && <Check className="size-3" />}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function AppearanceTab() {
  const [theme, setTheme] = useTheme();
  const options: { value: ThemePref; label: string; icon: LucideIcon; hint: string }[] = [
    { value: 'system', label: 'System', icon: Monitor, hint: 'Follow this device' },
    { value: 'light', label: 'Light', icon: Sun, hint: 'Warm paper tones' },
    { value: 'dark', label: 'Dark', icon: Moon, hint: 'Easy on the eyes at night' },
  ];
  return (
    <Group title="Theme" description="Photos always show on a neutral dark stage so colors read true.">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        {options.map((o) => (
          <ChoiceCard key={o.value} selected={theme === o.value} onSelect={() => setTheme(o.value)} title={o.label} subtitle={o.hint} icon={<o.icon className="mt-0.5 size-4 text-muted" aria-hidden />} />
        ))}
      </div>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// AI & server
// ---------------------------------------------------------------------------

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em] text-text">{children}</code>;
}

function ServerTab() {
  const health = useStore((s) => s.health);
  const level = aiLevel(health);
  const providers = imageProvidersOf(health);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      await useStore.getState().refreshHealth();
    } finally {
      setChecking(false);
    }
  };

  const rows: { label: string; ok: boolean | null; value: ReactNode }[] = [
    { label: 'Mode server', ok: health ? health.ok : null, value: health ? (health.ok ? 'Connected' : 'Not reachable') : 'Checking…' },
    {
      label: 'AI (Claude)',
      ok: health ? health.ai.enabled : null,
      value: health?.ai.enabled ? health.ai.model ?? 'Enabled' : health ? 'Off' : '…',
    },
    {
      label: 'Photoreal images',
      ok: health ? providers.length > 0 : null,
      value: providers.length ? providers.map((p) => p.name).join(' · ') : health ? 'No provider' : '…',
    },
  ];

  return (
    <>
      <Group
        title="Status"
        description={aiSummary(level)}
        action={
          <Button size="sm" icon={<RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />} onClick={() => void check()} disabled={checking}>
            Check again
          </Button>
        }
      >
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 bg-surface px-3.5 py-2.5 text-sm">
              <span className="flex items-center gap-2 text-text">
                <span className={cn('size-2 rounded-full', r.ok === null ? 'bg-line-strong' : r.ok ? 'bg-success' : 'bg-subtle')} aria-hidden />
                {r.label}
              </span>
              <span className="min-w-0 truncate text-right text-xs text-muted">{r.value}</span>
            </li>
          ))}
        </ul>
      </Group>

      {level !== 'ready' && (
        <Group title="Turn on AI features" description="Keys stay on the server — the browser never sees them.">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted marker:text-subtle">
            <li>
              Create a <Code>.env</Code> file next to <Code>package.json</Code> (copy <Code>.env.example</Code>).
            </li>
            <li>
              Add your keys:
              <pre className="mt-1.5 overflow-x-auto rounded-lg bg-stage p-3 font-mono text-xs leading-relaxed text-white/90">
                {`ANTHROPIC_API_KEY=sk-ant-…   # scene mapping, planning, suggestions
OPENAI_API_KEY=sk-…          # photoreal variations (OpenAI)
GEMINI_API_KEY=…             # photoreal variations (Gemini)
IMAGE_PROVIDER=openai        # optional default: openai | gemini`}
              </pre>
            </li>
            <li>
              Restart the server (<Code>npm run dev</Code> or <Code>npm start</Code>), then press <em>Check again</em>.
            </li>
          </ol>
        </Group>
      )}

      <TokenSettings />
    </>
  );
}

function TokenSettings() {
  const [saved, setSaved] = useState(readApiToken);
  const [value, setValue] = useState(saved);
  const [show, setShow] = useState(false);
  const dirty = value.trim() !== saved;
  const apply = (v: string) => {
    if (!saveApiToken(v)) {
      useStore.getState().notify("This browser blocked saving the token (private mode?). It can't be remembered here.", 'error');
      return;
    }
    setSaved(v.trim());
    setValue(v.trim());
    useStore.getState().notify(v.trim() ? 'Access token saved on this device.' : 'Access token removed.', 'success');
    void useStore.getState().refreshHealth();
  };
  return (
    <Group
      title={
        <span className="inline-flex items-center gap-1.5">
          <KeyRound className="size-4 text-muted" aria-hidden /> Server access token
        </span>
      }
      description={
        <>
          Only needed when the server sets <Code>MODE_ACCESS_TOKEN</Code> (e.g. when it’s reachable from the internet). Stored in this browser
          and sent with AI requests.
        </>
      }
    >
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          apply(value);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <TextInput
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={saved ? undefined : 'Paste the token'}
            autoComplete="off"
            spellCheck={false}
            aria-label="Server access token"
            className="pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide token' : 'Show token'}
            className="absolute inset-y-0 right-1 my-auto inline-flex size-7 items-center justify-center rounded-md text-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!dirty}>
            Save
          </Button>
          {saved && (
            <Button type="button" onClick={() => apply('')}>
              Remove
            </Button>
          )}
        </div>
      </form>
      {saved && !dirty && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <ShieldCheck className="size-3.5" aria-hidden /> A token is saved on this device.
        </p>
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Storage & data
// ---------------------------------------------------------------------------

interface StorageInfo {
  usage?: number;
  quota?: number;
  persisted?: boolean;
  supported: boolean;
}

function useStorageInfo(): [StorageInfo | null, () => void] {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const load = useCallback(async () => {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) {
      setInfo({ supported: false });
      return;
    }
    try {
      const [est, persisted] = await Promise.all([storage.estimate(), storage.persisted?.().catch(() => undefined)]);
      setInfo({ supported: true, usage: est.usage, quota: est.quota, persisted });
    } catch {
      setInfo({ supported: false });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return [info, () => void load()];
}

function StorageTab() {
  const project = useStore((s) => s.project);
  const projectCount = useStore((s) => s.projects.length);
  const libraryCount = useStore((s) => s.library.length);
  const [info, reload] = useStorageInfo();
  const [persisting, setPersisting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pct = info?.usage !== undefined && info.quota ? Math.min(100, (info.usage / info.quota) * 100) : null;

  return (
    <>
      <Group title="Storage on this device" description="Projects, photos and generated images are kept in this browser’s storage (IndexedDB).">
        {!info ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Measuring…
          </p>
        ) : !info.supported ? (
          <p className="text-sm text-muted">This browser doesn’t report storage usage.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-text">
                <strong className="font-semibold">{formatBytes(info.usage)}</strong> used
              </span>
              <span className="text-xs text-muted">of about {formatBytes(info.quota)} available</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-label="Storage used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct === null ? undefined : Math.round(pct)}
            >
              <div className={cn('h-full rounded-full', pct !== null && pct > 85 ? 'bg-warning' : 'bg-accent')} style={{ width: `${Math.max(1.5, pct ?? 0)}%` }} />
            </div>
            <p className="text-xs text-muted">
              {projectCount} project{projectCount === 1 ? '' : 's'} · {libraryCount} custom asset{libraryCount === 1 ? '' : 's'}
            </p>
          </div>
        )}
        {info?.supported && (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/60 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <ShieldCheck className={cn('mt-0.5 size-4 shrink-0', info.persisted ? 'text-success' : 'text-subtle')} aria-hidden />
              {info.persisted
                ? 'Protected: the browser won’t clear Mode’s data to free up space.'
                : 'Not protected yet: the browser may clear data when the disk is nearly full. Back up important projects.'}
            </p>
            {!info.persisted && (
              <Button
                size="sm"
                loading={persisting}
                onClick={async () => {
                  setPersisting(true);
                  try {
                    const ok = await db.requestPersistentStorage();
                    useStore
                      .getState()
                      .notify(ok ? 'Storage is now protected.' : 'The browser declined. Installing Mode or using it more often can help.', ok ? 'success' : 'info');
                  } finally {
                    setPersisting(false);
                    reload();
                  }
                }}
              >
                Keep my data
              </Button>
            )}
          </div>
        )}
      </Group>

      <Group title="Backups" description="A backup is one .json file with the project’s photos, scene maps, variations and designs.">
        <div className="flex flex-wrap gap-2">
          {project && (
            <Button
              icon={<Archive className="size-4" />}
              loading={backingUp}
              onClick={async () => {
                setBackingUp(true);
                try {
                  await useStore.getState().exportProject();
                } catch (err) {
                  useStore.getState().notify(`Backup failed: ${errorText(err)}`, 'error');
                } finally {
                  setBackingUp(false);
                }
              }}
            >
              Back up “{project.name}”
            </Button>
          )}
          <Button icon={<FolderInput className="size-4" />} loading={importing} onClick={() => fileRef.current?.click()}>
            Import a project…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setImporting(true);
              try {
                await useStore.getState().importProject(file);
                closeSettings();
              } finally {
                setImporting(false);
              }
            }}
          />
        </div>
        <p className="text-xs text-muted">Importing always creates a new project — nothing existing is overwritten.</p>
      </Group>

      {project && (
        <Group title="Danger zone">
          <div className="flex flex-col gap-3 rounded-xl border border-danger/30 p-3">
            {confirmDelete ? (
              <>
                <p className="text-sm leading-relaxed text-text">
                  Delete <strong>“{project.name}”</strong> with all its photos, scene maps, variations and designs? This can’t be undone.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" onClick={() => setConfirmDelete(false)} autoFocus>
                    Keep it
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 className="size-3.5" />}
                    onClick={() => {
                      const { id, name } = project;
                      closeSettings();
                      void useStore
                        .getState()
                        .deleteProject(id)
                        .then(
                          () => useStore.getState().notify(`Deleted “${name}”.`, 'info'),
                          (err: unknown) => useStore.getState().notify(`Couldn't delete the project: ${errorText(err)}`, 'error'),
                        );
                    }}
                  >
                    Delete permanently
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-relaxed text-muted">Delete this project and all its photos, variations and designs from this device.</p>
                <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                  Delete project
                </Button>
              </div>
            )}
          </div>
        </Group>
      )}
    </>
  );
}
