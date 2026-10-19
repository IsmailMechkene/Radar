import {
  Check,
  ChevronLeft,
  Circle,
  CircleAlert,
  CircleCheck,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { AccountInfo, AuthStatus } from '../../../shared/ipc';
import {
  newPasswordProblem,
  passwordChecks,
  passwordStrength,
  STRENGTH_LABELS,
} from '../../../shared/password';
import { BrandMark } from '../../components/Brand';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { TextInput } from '../../components/Input';
import { WindowControls } from '../../components/WindowControls';
import { cn } from '../../components/lib/cn';
import { cleanIpcError } from '../lib/settings-helpers';
import { LockPanel } from './LockPanel';

export interface FooterLink {
  question: string;
  action: string;
  onClick: () => void;
}

/**
 * The login window: a 42 px title row (brand on the left, window buttons on the right) that drags
 * the window; below it the screen in a narrow centred column on the left, and the panel on the
 * right. A screen may add a back link above its title and a footer link (the other way in).
 */
export function LockFrame({
  children,
  back,
  footer,
}: {
  children: ReactNode;
  back?: { label: string; onClick: () => void };
  footer?: FooterLink;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <header className="app-drag flex h-(--lock-titlebar-height) shrink-0">
        <div className="lock-brand flex min-w-0 flex-1 items-center gap-2.5 px-5">
          <BrandMark size="sm" />
          <span className="text-callout font-semibold tracking-brand">Radar</span>
        </div>
        <div className="flex w-(--lock-panel-width) shrink-0 justify-end">
          <WindowControls />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 overflow-y-auto px-10 pt-2 pb-6">
          {/* m-auto centres the column and still scrolls from the top when it is taller. */}
          <div className="m-auto flex w-full max-w-(--lock-form-width) flex-col">
            {back && (
              <button
                type="button"
                onClick={back.onClick}
                className="focus-ring -ml-1 mb-3.5 flex h-6 items-center gap-1 self-start rounded-xs pr-2 pl-1 text-subhead text-fg-2 transition-colors duration-(--duration-fast) hover:bg-fill"
              >
                <Icon icon={ChevronLeft} size={15} />
                {back.label}
              </button>
            )}
            {children}
            {footer && (
              <div className="mt-5 flex justify-center gap-1.25 hairline-t border-line pt-4 text-subhead">
                <span className="text-fg-2">{footer.question}</span>
                <button
                  type="button"
                  onClick={footer.onClick}
                  className="focus-ring rounded-2xs font-medium text-accent-text hover:underline"
                >
                  {footer.action}
                </button>
              </div>
            )}
          </div>
        </main>
        <div className="w-(--lock-panel-width) shrink-0 pr-3 pb-3">
          <LockPanel />
        </div>
      </div>
    </div>
  );
}

const HERO_TONES = {
  accent: 'bg-accent-soft text-accent-text',
  green: 'bg-green-soft text-green',
} as const;

/** Title and one line of explanation; `icon` puts a 44 px tile above (emails, done). */
export function Heading({
  title,
  icon,
  tone = 'accent',
  children,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: keyof typeof HERO_TONES;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4">
      {icon && (
        <div className={cn('mb-4 grid size-11 place-items-center rounded-xl', HERO_TONES[tone])}>
          <Icon icon={icon} size={22} />
        </div>
      )}
      <h1 className="text-title-login font-semibold tracking-title-login">{title}</h1>
      {children && (
        <p className="mt-2 text-body leading-normal text-pretty text-fg-2">{children}</p>
      )}
    </div>
  );
}

/** A labelled field; `aside` sits at the end of the label row, `error` under the field. */
export function Field({
  label,
  aside,
  error,
  children,
}: {
  label: string;
  aside?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline">
        <label htmlFor={id} className="text-footnote font-semibold text-fg-2">
          {label}
        </label>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      {children(id)}
      <ErrorLine message={error ?? null} />
    </div>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.25 text-footnote text-red">
      <Icon icon={CircleAlert} size={13} className="mt-px shrink-0" />
      {message}
    </p>
  );
}

/** Runs an auth call: busy while it runs, the cleaned error message when it fails. */
export function useAuthAction(onDone: (s: AuthStatus) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (call: () => Promise<AuthStatus>) => {
    setBusy(true);
    setError(null);
    call().then(
      (s) => {
        setBusy(false);
        onDone(s);
      },
      (err: unknown) => {
        setBusy(false);
        setError(cleanIpcError(err));
      },
    );
  };
  return { busy, error, setError, run };
}

/** Counts down from `seconds` (resend links and codes); restart() starts it again. */
export function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const label = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return { left, label, restart: () => setLeft(seconds) };
}

/** Password field with a show/hide button at its end. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  autoFocus,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative flex">
      <TextInput
        id={id}
        size="lg"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        spellCheck={false}
        value={value}
        invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 pr-9"
      />
      <button
        type="button"
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown((s) => !s)}
        className="focus-ring absolute top-1 right-1 grid size-6.5 place-items-center rounded-xs text-fg-3 transition-colors duration-(--duration-fast) hover:bg-fill-2"
      >
        <Icon icon={shown ? EyeOff : Eye} size={15} />
      </button>
    </div>
  );
}

const BAR = ['bg-fill-2', 'bg-red-fill', 'bg-amber-fill', 'bg-green-fill', 'bg-green-fill'];
const BAR_TEXT = ['', 'text-red', 'text-amber', 'text-green', 'text-green'];

/**
 * A new password: one field (with show/hide), a four-step strength bar and the three
 * requirements, ticked as they are met. The problem shows after a submit.
 */
export function NewPasswordField({
  label = 'Create a password',
  value,
  onChange,
  submitted,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  submitted: boolean;
  autoFocus?: boolean;
}) {
  const problem = submitted ? newPasswordProblem(value) : null;
  const strength = passwordStrength(value);
  return (
    <>
      <Field label={label} error={problem}>
        {(id) => (
          <PasswordInput
            id={id}
            value={value}
            onChange={onChange}
            autoComplete="new-password"
            autoFocus={autoFocus}
            invalid={!!problem}
          />
        )}
      </Field>
      <div className="-mt-1 flex flex-col gap-1.75" aria-live="polite">
        <div className="flex items-center gap-2">
          <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={cn('h-1 rounded-full', i <= strength ? BAR[strength] : 'bg-fill-2')}
              />
            ))}
          </div>
          <span className={cn('w-11.5 text-right text-caption font-semibold', BAR_TEXT[strength])}>
            {STRENGTH_LABELS[strength]}
          </span>
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {passwordChecks(value).map((c) => (
            <li
              key={c.label}
              className={cn(
                'flex items-center gap-1.25 text-caption',
                c.met ? 'text-green' : 'text-fg-3',
              )}
            >
              <Icon icon={c.met ? CircleCheck : Circle} size={13} stroke={2} />
              {c.label}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** The login window's full-width primary button (34 px), 20 px under the fields. */
export function SubmitButton({
  busy,
  disabled,
  children,
  onClick,
}: {
  busy: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button
      type={onClick ? 'button' : 'submit'}
      variant="primary"
      size="xl"
      disabled={busy || disabled}
      onClick={onClick}
      className="mt-2 w-full"
    >
      {busy && (
        <span
          aria-hidden="true"
          className="size-3.25 animate-spin rounded-full border-2 border-on-accent/40 border-t-on-accent"
        />
      )}
      {children}
    </Button>
  );
}

/** First run: choose the password that encrypts everything Radar stores. */
export function SetupScreen({
  hasPlainData,
  onDone,
}: {
  hasPlainData: boolean;
  onDone: (s: AuthStatus) => void;
}) {
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (newPasswordProblem(password)) return;
    run(() => window.radar.auth.setup(password));
  };

  return (
    <LockFrame>
      <Heading title="Set up Radar">
        Choose a password. Radar encrypts everything it stores on this computer with it, and asks
        for it each time it opens.
        {hasPlainData && ' Your existing data will be encrypted too.'}
      </Heading>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <NewPasswordField value={password} onChange={setPassword} submitted={submitted} autoFocus />
        <ErrorLine message={error} />
        <SubmitButton busy={busy}>
          {busy ? (hasPlainData ? 'Encrypting your data…' : 'Setting up…') : 'Continue'}
        </SubmitButton>
      </form>
    </LockFrame>
  );
}

/** Shown once after setup (or a new key at unlock): the only way back in without the password. */
export function RecoveryKeyScreen({
  recoveryKey,
  onDone,
}: {
  recoveryKey: string;
  onDone: (s: AuthStatus) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const { busy, error, setError, run } = useAuthAction(onDone);

  const copy = () => {
    window.radar.app.copyText(recoveryKey).then(
      () => setCopied(true),
      (err: unknown) => setError(`Not copied: ${cleanIpcError(err)}`),
    );
  };

  return (
    <LockFrame>
      <Heading title="Save your recovery key" icon={KeyRound}>
        If you forget your password, this key is the only way to open your data, here and on your
        other computers. Radar shows it once. Keep it somewhere safe, away from this computer.
      </Heading>
      <div className="flex flex-col gap-3">
        <div
          aria-label="Recovery key"
          className="rounded-lg bg-fill px-3 py-3 text-center font-mono text-headline leading-relaxed font-semibold tracking-caps text-fg select-all"
        >
          {/* Two lines of four groups, so no group is split when it wraps. */}
          {recoveryKey.split('-').map((group, i) => (
            <span key={i}>
              {group}
              {i < 7 && (i === 3 ? <br /> : '-')}
            </span>
          ))}
        </div>
        <Button size="xl" icon={copied ? Check : Copy} onClick={copy} className="w-full">
          {copied ? 'Copied' : 'Copy recovery key'}
        </Button>
        <div className="flex items-start gap-2.5">
          <span className="mt-px">
            <Checkbox checked={saved} onChange={setSaved} label="I saved my recovery key" />
          </span>
          <span
            className="cursor-default text-body text-fg select-none"
            onClick={() => setSaved((v) => !v)}
          >
            I saved my recovery key
          </span>
        </div>
        <ErrorLine message={error} />
        <SubmitButton
          busy={busy}
          disabled={!saved}
          onClick={() => run(() => window.radar.auth.confirmRecoveryKey())}
        >
          Continue
        </SubmitButton>
      </div>
    </LockFrame>
  );
}

/** Locked: the password, or the recovery key when it is forgotten. */
export function UnlockScreen({
  account,
  onDone,
}: {
  account: AccountInfo | null;
  onDone: (s: AuthStatus) => void;
}) {
  const [mode, setMode] = useState<'password' | 'forgot'>('password');
  if (mode === 'password') {
    return <PasswordUnlock account={account} onDone={onDone} onForgot={() => setMode('forgot')} />;
  }
  // Email users: the account password is also the lock, so it is reset by email (plus the
  // recovery key). Google users and data from before accounts: recovery key + new password.
  return account?.provider === 'email' ? (
    <ResetByEmail email={account.email} onDone={onDone} onBack={() => setMode('password')} />
  ) : (
    <RecoveryUnlock onDone={onDone} onBack={() => setMode('password')} />
  );
}

function ResetByEmail({
  email,
  onDone,
  onBack,
}: {
  email: string;
  onDone: (s: AuthStatus) => void;
  onBack: () => void;
}) {
  const { busy, error, run } = useAuthAction(onDone);
  return (
    <LockFrame back={{ label: 'Back', onClick: onBack }}>
      <Heading title="Reset your password">
        Radar emails a reset link to {email}. Open it on this computer, then choose a new password
        and enter your recovery key: it re-encrypts your data here with the new password.
      </Heading>
      <ErrorLine message={error} />
      <SubmitButton busy={busy} onClick={() => run(() => window.radar.auth.requestReset(email))}>
        {busy ? 'Sending…' : 'Send reset link'}
      </SubmitButton>
    </LockFrame>
  );
}

function PasswordUnlock({
  account,
  onDone,
  onForgot,
}: {
  account: AccountInfo | null;
  onDone: (s: AuthStatus) => void;
  onForgot: () => void;
}) {
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAuthAction(onDone);
  const google = account?.provider === 'google';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) run(() => window.radar.auth.unlock(password));
  };

  return (
    <LockFrame
      footer={{
        question: google ? 'Forgot your Radar password?' : 'Forgot your password?',
        action: account?.provider === 'email' ? 'Reset it' : 'Use recovery key',
        onClick: onForgot,
      }}
    >
      <Heading title="Welcome back">
        {account ? `Signed in as ${account.email}. ` : 'Radar is locked. '}
        {google
          ? 'Enter the Radar password you chose for this computer (not your Google password).'
          : 'Enter your password to open your data.'}
      </Heading>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Field label={google ? 'Radar password' : 'Password'} error={error}>
          {(id) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              autoFocus
              value={password}
              invalid={!!error}
              onChange={setPassword}
            />
          )}
        </Field>
        <SubmitButton busy={busy} disabled={!password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </SubmitButton>
      </form>
    </LockFrame>
  );
}

function RecoveryUnlock({
  onDone,
  onBack,
}: {
  onDone: (s: AuthStatus) => void;
  onBack: () => void;
}) {
  const [recoveryKey, setRecoveryKey] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!recoveryKey.trim() || newPasswordProblem(password)) return;
    run(() => window.radar.auth.recover(recoveryKey, password));
  };

  return (
    <LockFrame back={{ label: 'Back', onClick: onBack }}>
      <Heading title="Use your recovery key">
        The key you saved when you set your password opens your data. Then choose a new password.
      </Heading>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <RecoveryKeyField
          value={recoveryKey}
          onChange={setRecoveryKey}
          invalid={submitted && !recoveryKey.trim()}
          autoFocus
        />
        <NewPasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          submitted={submitted}
        />
        <ErrorLine message={error} />
        <SubmitButton busy={busy}>{busy ? 'Unlocking…' : 'Unlock and set password'}</SubmitButton>
      </form>
    </LockFrame>
  );
}

export function RecoveryKeyField({
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Field label="Recovery key">
      {(id) => (
        <TextInput
          id={id}
          size="lg"
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-…"
          className="font-mono"
          value={value}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** The data cannot be opened (keys.json damaged or missing). Nothing here can make it worse. */
export function LockErrorScreen({ message }: { message: string }) {
  return (
    <LockFrame>
      <Heading title="Radar can't open your data" />
      <ErrorLine message={message} />
    </LockFrame>
  );
}
