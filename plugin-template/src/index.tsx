import { definePlugin } from '@winnook/sdk';
import { useState } from 'react';

export default definePlugin({
  // The manifest is read from manifest.json; this copy only satisfies the type.
  manifest: {
    id: 'hello-world',
    name: 'Hello World',
    version: '1.0.0',
    author: 'Your Name',
    description: 'Example plugin: a click counter tile',
    slot: 'tile-small',
    permissions: ['storage'],
  },

  renderTile(ctx) {
    // Persisted automatically, survives restarts.
    const [count, setCount] = ctx.usePluginStore('count', 0);
    // Plain React state works too, but resets whenever the tile unmounts.
    const [hovered, setHovered] = useState(false);

    return (
      <button
        type="button"
        onClick={() => {
          setCount((c) => c + 1);
          ctx.shell.showToast(`Hello #${count + 1}`);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex h-full w-full items-center justify-between px-3 text-left"
      >
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          {hovered ? 'Click me!' : 'Hello World'}
        </span>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">{count}</span>
      </button>
    );
  },
});
