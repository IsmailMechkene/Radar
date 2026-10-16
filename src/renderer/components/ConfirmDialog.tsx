import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { BrandMark } from './Brand';
import { Button } from './Button';
import { WindowPortal } from './Overlay';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Small alert dialog (design: 280 px glass card over a dimmed window, app icon, two buttons).
 * Focus starts on Cancel, Tab stays inside, Esc or a click on the scrim cancels.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
    }
  }

  return (
    <WindowPortal>
      <div className="absolute inset-0 z-60 bg-dim animate-fade-in" onClick={onCancel} />
      <div className="pointer-events-none absolute inset-0 z-61 grid place-items-center">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${id}-t`}
          aria-describedby={`${id}-d`}
          onKeyDown={onKeyDown}
          className="pointer-events-auto w-70 rounded-2xl bg-glass px-4 pt-5 pb-4 text-center hairline border-glass-border shadow-pop backdrop-sidebar animate-pop-in"
        >
          <div className="mx-auto mb-3 w-max">
            <BrandMark size="lg" />
          </div>
          <div id={`${id}-t`} className="text-body font-bold">
            {title}
          </div>
          <div id={`${id}-d`} className="mt-1.5 text-footnote leading-normal text-fg-2">
            {message}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button ref={cancelRef} onClick={onCancel}>
              Cancel
            </Button>
            <Button ref={confirmRef} variant="destructive" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </WindowPortal>
  );
}
