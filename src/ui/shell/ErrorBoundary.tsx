/**
 * Keeps one broken area (a panel, the canvas) from taking down the whole app.
 * Shows a calm fallback with "Try again"; resets automatically when
 * `resetKey` changes (e.g. switching tabs or photos).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button, cn } from '../common';

interface Props {
  /** Short name of the area for the message, e.g. "This panel". */
  area: string;
  resetKey?: unknown;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'stage';
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Mode] ${this.props.area} crashed`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stage = this.props.tone === 'stage';
    return (
      <div
        role="alert"
        className={cn(
          'flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center',
          stage ? 'bg-stage text-white' : 'bg-surface text-text',
          this.props.className,
        )}
      >
        <div className={cn('rounded-2xl p-3', stage ? 'bg-white/10 text-white' : 'bg-danger-soft text-danger')}>
          <TriangleAlert className="size-6" aria-hidden />
        </div>
        <p className="font-medium">{this.props.area} ran into a problem</p>
        <p className={cn('max-w-sm text-sm', stage ? 'text-white/70' : 'text-muted')}>
          Your work is saved. Try again — if it keeps happening, reload the page.
        </p>
        <p className={cn('max-w-sm truncate font-mono text-xs', stage ? 'text-white/50' : 'text-subtle')} title={error.message}>
          {error.message}
        </p>
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
