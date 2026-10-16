import { Check, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

export type ToastTone = 'success' | 'error';

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onAction: () => void };
}

/** Design: auto-dismiss after 2.8 s. Errors stay longer so they can be read. */
export const TOAST_MS = { success: 2800, error: 6000 } as const;

interface ToastViewProps extends ToastInput {
  onDismiss?: () => void;
}

/** Glass pill toast, 40 px. Presentational; use `useToast()` to show one. */
export function ToastView({ message, tone = 'success', action, onDismiss }: ToastViewProps) {
  return (
    <div
      className={cn(
        'flex h-10 w-max max-w-160 items-center gap-2.5 rounded-full pr-2 pl-3.5',
        'bg-glass backdrop-glass hairline border-glass-border shadow-pop',
      )}
    >
      <span
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full text-on-accent',
          tone === 'success' ? 'bg-green-fill' : 'bg-red-fill',
        )}
      >
        <Icon icon={tone === 'success' ? Check : X} size={12} stroke={3} />
      </span>
      <span className="truncate text-body font-medium">{message}</span>
      {action ? (
        <button
          type="button"
          onClick={() => {
            action.onAction();
            onDismiss?.();
          }}
          className="focus-ring flex h-7 items-center rounded-full px-2.5 text-body font-semibold text-accent-text hover:bg-fill"
        >
          {action.label}
        </button>
      ) : (
        <span className="w-1" />
      )}
    </div>
  );
}

interface ToastState {
  toast: (ToastInput & { id: number }) | null;
  show: (t: ToastInput) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastState | null>(null);

function useToastState(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('Toasts need a <ToastProvider> ancestor');
  return ctx;
}

/** Returns `show(toast)`. One toast at a time; a new one replaces the old. */
export function useToast(): (t: ToastInput) => void {
  return useToastState().show;
}

/** Holds toast state. Render <ToastViewport /> where toasts should appear. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState['toast']>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);
  const show = useCallback((t: ToastInput) => {
    clearTimeout(timer.current);
    seq.current += 1;
    setToast({ ...t, id: seq.current });
    timer.current = setTimeout(() => setToast(null), TOAST_MS[t.tone ?? 'success']);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => ({ toast, show, dismiss }), [toast, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Centred at the bottom of the nearest positioned ancestor (the content column). */
export function ToastViewport() {
  const { toast, dismiss } = useToastState();
  const error = toast?.tone === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      className="pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2"
    >
      {toast && (
        <div key={toast.id} className="pointer-events-auto animate-toast-in">
          <ToastView {...toast} onDismiss={dismiss} />
        </div>
      )}
    </div>
  );
}
