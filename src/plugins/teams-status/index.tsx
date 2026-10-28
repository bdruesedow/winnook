import { MessageSquare } from 'lucide-react';
import { definePlugin } from '@winnook/sdk';
import type { PluginContext } from '@winnook/sdk';

const TEAMS_PURPLE = '#7B83EB';

function Indicator({ ctx }: { ctx: PluginContext }) {
  const { unreadCount, focusTeams } = ctx.system.teams.useTeamsStatus();
  if (unreadCount <= 0) return null;
  return (
    <button
      type="button"
      title={`${unreadCount} unread in Teams`}
      onClick={(e) => {
        e.stopPropagation();
        void focusTeams().catch(() => ctx.shell.showToast('Teams window not found'));
      }}
      className="relative flex h-5 w-5 items-center justify-center"
    >
      <MessageSquare size={14} style={{ color: TEAMS_PURPLE }} fill={TEAMS_PURPLE} fillOpacity={0.25} />
      <span className="absolute -right-1 -top-1 flex h-3 min-w-3 animate-pulse items-center justify-center rounded-full bg-red-500 px-[3px] text-[8px] font-bold leading-none text-white">
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    </button>
  );
}

export default definePlugin({
  manifest: {
    id: 'teams-status',
    name: 'Teams Status',
    version: '1.0.0',
    author: 'WinNook',
    description: 'Unread Teams notifications in the pill (local only)',
    slot: 'background',
    defaultOrder: 21,
    permissions: ['teams'],
  },
  renderPillIndicator: (ctx) => <Indicator ctx={ctx} />,
});
