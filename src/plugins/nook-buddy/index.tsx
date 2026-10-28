import { definePlugin } from '@winnook/sdk';
import type { PluginContext } from '@winnook/sdk';
import { useShellStore } from '../../store/useShellStore';
import { useDodgeStore } from '../../store/useDodgeStore';
import { pet, worstNeed } from '../nook-pet/petStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { coffee } from '../coffee';
import { NookBuddyEyes } from './NookBuddyEyes';
import { useBuddyBrain } from './useBuddyBrain';

function Buddy({ ctx }: { ctx: PluginContext }) {
  const mode = useSettingsStore((s) => s.nookBuddy);
  const accent = useSettingsStore((s) => s.accentHex);
  const cursor = ctx.system.cursor.useCursorTracking();
  const media = ctx.system.media.useMediaSession();
  const caffeinated = coffee.use().active;
  const teams = ctx.system.teams.useTeamsStatus();
  const expanded = useShellStore((s) => s.view.kind !== 'collapsed');
  const dodge = useDodgeStore((s) => s.mood);
  const petState = pet.use();
  const need = petState.active ? worstNeed(petState) : null;
  const view = useBuddyBrain({
    mode,
    cursor,
    media,
    caffeinated,
    call: { isInCall: teams.isInCall, isMicActive: teams.isMicActive },
    interacting: expanded,
    dodge,
    need,
    reaction: petState.active ? petState.reaction : null,
  });
  if (mode === 'off') return null;
  return <NookBuddyEyes view={view} accent={accent} />;
}

export default definePlugin({
  manifest: {
    id: 'nook-buddy',
    name: 'Nook Buddy',
    version: '1.0.0',
    author: 'WinNook',
    description: 'A little companion living in the pill',
    slot: 'background',
    defaultOrder: 20,
    permissions: ['cursor', 'media', 'teams'],
  },
  renderPillIndicator: (ctx) => <Buddy ctx={ctx} />,
});
