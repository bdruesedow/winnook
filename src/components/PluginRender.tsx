import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { PluginContext, NookPlugin } from '../sdk/types';

export type RenderKind = 'renderTile' | 'renderActionIcon' | 'renderFullView' | 'renderPillIndicator';

interface BoundaryProps {
  pluginId: string;
  children: ReactNode;
  fallback?: ReactNode;
}

class PluginBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[WinNook] plugin "${this.props.pluginId}" crashed`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-red-500">
            {this.props.pluginId} crashed
          </div>
        )
      );
    }
    return this.props.children;
  }
}

function Invoke({ plugin, kind, ctx }: { plugin: NookPlugin; kind: RenderKind; ctx: PluginContext }) {
  // Called as a method so plugins may use `this`; hooks run inside this component.
  const node = plugin[kind]?.(ctx);
  return <>{node}</>;
}

interface PluginRenderProps {
  plugin: NookPlugin;
  ctx: PluginContext;
  kind: RenderKind;
}

export function PluginRender({ plugin, ctx, kind }: PluginRenderProps) {
  if (!plugin[kind]) return null;
  return (
    <PluginBoundary pluginId={plugin.manifest.id} fallback={kind === 'renderPillIndicator' ? null : undefined}>
      <Invoke plugin={plugin} kind={kind} ctx={ctx} />
    </PluginBoundary>
  );
}
