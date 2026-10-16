import { cn } from './lib/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; required because the switch has no visible text of its own. */
  label: string;
  disabled?: boolean;
}

/** 36 x 22 switch. Knob moves on a spring (overshoot 1.4, 250 ms). */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring app-no-drag relative h-5.5 w-9 shrink-0 rounded-full disabled:opacity-40',
        'transition-colors duration-(--duration-base) ease-out',
        checked ? 'bg-accent' : 'bg-track',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 left-0.5 size-4.5 rounded-full bg-knob shadow-knob',
          'transition-transform duration-(--duration-switch) ease-spring',
          checked ? 'translate-x-3.5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
