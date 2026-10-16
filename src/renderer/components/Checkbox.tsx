import { Check } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** 16 px checkbox, radius 5. Used for row selection. */
export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring grid size-4 shrink-0 place-items-center rounded-2xs text-on-accent',
        checked ? 'bg-accent hairline border-accent' : 'border border-line-2 bg-surface',
      )}
    >
      {checked && <Icon icon={Check} size={11} stroke={3} />}
    </button>
  );
}
