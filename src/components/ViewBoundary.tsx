import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/** Keeps a crashing view from taking the whole notch down. Remount via `key` to reset. */
export class ViewBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[WinNook] view crashed', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full items-center justify-center p-4 text-center text-[11px] text-red-500">
          {String(this.state.error.message)}
        </div>
      );
    }
    return this.props.children;
  }
}
