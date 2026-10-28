import { motion } from 'framer-motion';
import { useId, type ReactNode } from 'react';

export const SPRING = { type: 'spring', stiffness: 400, damping: 30 } as const;

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  const groupId = useId();
  return (
    <div className="relative flex rounded-lg bg-black/10 p-0.5 dark:bg-white/10">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-10 flex-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              selected ? 'text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            {selected && (
              <motion.span
                layoutId={`seg-${groupId}`}
                transition={SPRING}
                className="absolute inset-0 -z-10 rounded-md bg-accent"
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-black/20 dark:bg-white/20',
      )}
    >
      <motion.span
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow"
        animate={{ x: checked ? 16 : 0 }}
        transition={SPRING}
      />
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
      {children}
    </h3>
  );
}
