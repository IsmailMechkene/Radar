import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthStatus } from '../../../shared/ipc';
import { newPasswordProblem } from '../../../shared/password';
import { BrandMark } from '../../components/Brand';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { TextInput } from '../../components/Input';
import { cleanIpcError } from '../lib/settings-helpers';
import { LockPanel } from './LockPanel';

/**
 * The login window: on the left the brand, a link on the right of the same row (the other way in),
 * and the screen centred in a narrow column; on the right the radar panel. The top rows drag the
 * window; the native buttons sit above the panel.
 */
function LockFrame({ children, topRight }: { children: ReactNode; topRight?: ReactNode }) {
  return (
    <div className="flex h-full w-full bg-bg">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="lock-brand app-drag flex h-(--toolbar-height) shrink-0 items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span className="text-callout font-semibold tracking-brand">Radar</span>
          </div>
          {topRight && (
            <div className="app-no-drag flex items-center gap-1 text-footnote text-fg-3">
              {topRight}
            </div>
          )}
        </header>
        <main className="flex min-h-0 flex-1 overflow-y-auto px-10">
          {/* m-auto centres the column and still scrolls from the top when it is taller. */}
          <div className="m-auto w-full max-w-(--lock-form-width) py-8">{children}</div>
        </main>
      </section>
      <LockPanel />
    </div>
  );
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-title-2 font-semibold tracking-title-2">{title}</h1>
      {children && <p className="mt-2 text-body leading-normal text-fg-2">{children}</p>}
    </div>
  );
}

/** Top-right link: a plain question, then the action. */
function TopLink({
  question,
  action,
  onClick,
}: {
  question: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <>
      <span>{question}</span>
      <Button variant="plain" size="sm" onClick={onClick} className="px-1">
        {action}
      </Button>
    </>
  );
}

function Step({ n }: { n: number }) {
  return <span className="tabular-nums">Step {n} of 2</span>;
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote font-semibold text-fg-2">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-footnote text-red">
      <Icon icon={TriangleAlert} size={13} className="mt-px shrink-0" />
      {message}
    </p>
  );
}

/** Runs an auth call: busy while it runs, the cleaned error message when it fails. */
function useAuthAction(onDone: (s: AuthStatus) => void) {
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

/** New password typed twice; the problem shows once both were typed or after a submit. */
function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  showProblem,
  autoFocus,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  showProblem: boolean;
  autoFocus?: boolean;
}) {
  const problem = showProblem ? newPasswordProblem(password, confirm) : null;
  return (
    <>
      <Field label="Password">
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoComplete="new-password"
            autoFocus={autoFocus}
            value={password}
            invalid={!!problem && problem !== 'The passwords do not match'}
            onChange={(e) => onPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label="Confirm password">
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoComplete="new-password"
            value={confirm}
            invalid={problem === 'The passwords do not match'}
            onChange={(e) => onConfirm(e.target.value)}
          />
        )}
      </Field>
      <ErrorLine message={problem} />
    </>
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
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (newPasswordProblem(password, confirm)) return;
    run(() => window.radar.auth.setup(password));
  };

  return (
    <LockFrame topRight={<Step n={1} />}>
      <Heading title="Set up Radar">
        Choose a password. Radar encrypts everything it stores on this computer with it, and asks
        for it each time it opens.
        {hasPlainData && ' Your existing data will be encrypted too.'}
      </Heading>
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          showProblem={submitted || confirm.length > 0}
          autoFocus
        />
        <ErrorLine message={error} />
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-1 w-full">
          {busy ? (hasPlainData ? 'Encrypting your data…' : 'Setting up…') : 'Continue'}
        </Button>
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
    <LockFrame topRight={<Step n={2} />}>
      <Heading title="Save your recovery key">
        If you forget your password, this key is the only way to open your data. Radar shows it
        once. Keep it somewhere safe, away from this computer.
      </Heading>
      <div className="flex flex-col gap-3.5">
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
        <Button icon={copied ? Check : Copy} onClick={copy} className="w-full">
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
        <Button
          variant="primary"
          size="lg"
          disabled={!saved || busy}
          className="mt-1 w-full"
          onClick={() => run(() => window.radar.auth.confirmRecoveryKey())}
        >
          Continue
        </Button>
      </div>
    </LockFrame>
  );
}

/** Locked: the password, or the recovery key when it is forgotten. */
export function UnlockScreen({ onDone }: { onDone: (s: AuthStatus) => void }) {
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  return mode === 'password' ? (
    <PasswordUnlock onDone={onDone} onForgot={() => setMode('recovery')} />
  ) : (
    <RecoveryUnlock onDone={onDone} onBack={() => setMode('password')} />
  );
}

function PasswordUnlock({
  onDone,
  onForgot,
}: {
  onDone: (s: AuthStatus) => void;
  onForgot: () => void;
}) {
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) run(() => window.radar.auth.unlock(password));
  };

  return (
    <LockFrame
      topRight={
        <TopLink question="Forgot your password?" action="Use recovery key" onClick={onForgot} />
      }
    >
      <Heading title="Welcome back">
        Radar is locked. Enter your password to open your data.
      </Heading>
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <Field label="Password">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              invalid={!!error}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <ErrorLine message={error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={busy || !password}
          className="mt-1 w-full"
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
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
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!recoveryKey.trim() || newPasswordProblem(password, confirm)) return;
    run(() => window.radar.auth.recover(recoveryKey, password));
  };

  return (
    <LockFrame
      topRight={<TopLink question="Remember it?" action="Use password" onClick={onBack} />}
    >
      <Heading title="Use your recovery key">
        The key you saved when you set your password opens your data. Then choose a new password.
      </Heading>
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <Field label="Recovery key">
          {(id) => (
            <TextInput
              id={id}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-…"
              className="font-mono"
              value={recoveryKey}
              invalid={submitted && !recoveryKey.trim()}
              onChange={(e) => setRecoveryKey(e.target.value)}
            />
          )}
        </Field>
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          showProblem={submitted || confirm.length > 0}
        />
        <ErrorLine message={error} />
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-1 w-full">
          {busy ? 'Unlocking…' : 'Unlock and set password'}
        </Button>
      </form>
    </LockFrame>
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
