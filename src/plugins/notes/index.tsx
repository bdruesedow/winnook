import { StickyNote } from 'lucide-react';
import { definePlugin } from '@winnook/sdk';

export default definePlugin({
  manifest: {
    id: 'notes',
    name: 'Notes',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Quick note with instant auto-save',
    slot: 'tile-small',
    defaultOrder: 4,
    permissions: ['storage'],
  },
  renderTile(ctx) {
    const [text, setText] = ctx.usePluginStore('text', '');
    return (
      <div className="flex h-full items-start gap-2 p-2.5">
        <StickyNote size={15} className="mt-0.5 shrink-0 text-accent" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write something"
          spellCheck={false}
          className="h-full min-w-0 flex-1 resize-none bg-transparent text-[11px] leading-snug text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>
    );
  },
});
