import { Globe, Mail } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { AccountInfo, AuthStatus } from '../../../shared/ipc';
import { newPasswordProblem } from '../../../shared/password';
import { GoogleMark } from '../../components/Brand';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/Input';
import { cn } from '../../components/lib/cn';
import { cleanIpcError } from '../lib/settings-helpers';
import {
  ErrorLine,
  Field,
  Heading,
  LockFrame,
  NewPasswordField,
  PasswordInput,
  RecoveryKeyField,
  SubmitButton,
  useAuthAction,
  useCountdown,
} from './LockScreens';

type Done = (s: AuthStatus) => void;

/** Supabase lets a confirmation or reset email go out again after a minute. */
const RESEND_SECONDS = 60;
/** Digits in the code of a confirmation email (Supabase's default OTP length). */
const CODE_LENGTH = 6;

/** "Continue with Google": secondary, full width, Google's mark (Google's branding rules). */
function GoogleButton({ onDone }: { onDone: Done }) {
  const { busy, error, run } = useAuthAction(onDone);
  return (
    <div className="mt-1 flex flex-col gap-2">
      <Button
        size="xl"
        disabled={busy}
        className="w-full gap-2.5"
        onClick={() => run(() => window.radar.auth.google())}
      >
        <GoogleMark />
        {busy ? 'Opening your browser…' : 'Continue with Google'}
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}

function OrWithEmail() {
  return (
    <div className="mt-4 flex items-center gap-2.5 text-caption text-fg-3" aria-hidden="true">
      <span className="h-px flex-1 hairline-t border-line-2" />
      or with email
      <span className="h-px flex-1 hairline-t border-line-2" />
    </div>
  );
}

/** "Didn't get it? Resend in 0:42", then a Resend link. */
function Resend({ label, onResend }: { label: string; onResend: () => Promise<unknown> }) {
  const countdown = useCountdown(RESEND_SECONDS);
  const [again, setAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p className="mt-3.5 flex justify-center gap-1.25 text-center text-footnote text-fg-3">
        {countdown.left > 0 ? (
          <span className="tabular-nums">
            {again ? 'Sent again. ' : 'Didn’t get it? '}Resend in {countdown.label}
          </span>
        ) : (
          <>
            <span>Didn’t get it?</span>
            <button
              type="button"
              className="focus-ring rounded-2xs font-medium text-accent-text hover:underline"
              onClick={() => {
                setError(null);
                onResend().then(
                  () => {
                    setAgain(true);
                    countdown.restart();
                  },
                  (err: unknown) => setError(`Not sent: ${cleanIpcError(err)}`),
                );
              }}
            >
              {label}
            </button>
          </>
        )}
      </p>
      <div className="mt-2 flex justify-center">
        <ErrorLine message={error} />
      </div>
    </>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Purpose = Extract<AuthStatus, { state: 'signin' }>['purpose'];

/**
 * Sign in, create an account, or ask for a reset link. `new`: first run. `connect`: data set up
 * before accounts gets linked. `again`: the data belongs to `account`; only that one can sign in.
 */
export function SignInScreen({
  purpose,
  account,
  hasPlainData,
  problem,
  onDone,
}: {
  purpose: Purpose;
  account: AccountInfo | null;
  hasPlainData: boolean;
  problem: string | null;
  onDone: Done;
}) {
  const [mode, setMode] = useState<'signin' | 'create' | 'forgot'>(
    purpose === 'new' ? 'create' : 'signin',
  );
  const [email, setEmail] = useState(account?.email ?? '');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, setError, run } = useAuthAction(onDone);
  const canCreate = purpose !== 'again';
  const emailOk = EMAIL.test(email.trim());
  const emailError = submitted && !emailOk ? 'Enter a valid email address.' : null;

  const go = (next: typeof mode) => {
    setMode(next);
    setSubmitted(false);
    setPassword('');
    setError(null); // an error belongs to the form it came from
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!emailOk) return;
    const address = email.trim();
    if (mode === 'forgot') return run(() => window.radar.auth.requestReset(address));
    if (mode === 'create') {
      if (newPasswordProblem(password)) return;
      return run(() => window.radar.auth.createAccount(address, password));
    }
    if (password) run(() => window.radar.auth.signIn(address, password));
  };

  const title =
    mode === 'forgot'
      ? 'Reset your password'
      : purpose === 'connect'
        ? 'Connect an account'
        : purpose === 'again'
          ? 'Sign in again'
          : mode === 'create'
            ? 'Create your account'
            : 'Sign in to Radar';

  const intro =
    mode === 'forgot'
      ? 'Enter the email you signed up with. Radar sends a link to choose a new password.'
      : purpose === 'connect'
        ? 'Radar now works with an account. Sign in or create one; your data on this computer stays encrypted and is linked to it.'
        : purpose === 'again' && account
          ? `Radar's data on this computer belongs to ${account.email}. Sign in with that account.`
          : mode === 'create'
            ? `Your account password also encrypts Radar's data on this computer.${hasPlainData ? ' Your existing data will be encrypted too.' : ''}`
            : 'Your pipeline, rules, drafts and settings follow you to every computer, encrypted end to end.';

  const footer =
    mode === 'create'
      ? { question: 'Have an account?', action: 'Sign in', onClick: () => go('signin') }
      : mode === 'signin' && canCreate
        ? { question: 'New to Radar?', action: 'Create account', onClick: () => go('create') }
        : undefined;

  return (
    <LockFrame
      back={
        mode === 'forgot' ? { label: 'Back to sign in', onClick: () => go('signin') } : undefined
      }
      footer={footer}
    >
      <Heading title={title}>{intro}</Heading>
      {mode !== 'forgot' && (
        <>
          <GoogleButton onDone={onDone} />
          <OrWithEmail />
        </>
      )}
      <form className="mt-4 flex flex-col gap-3" onSubmit={submit} noValidate>
        <Field label="Email" error={emailError}>
          {(id) => (
            <TextInput
              id={id}
              size="lg"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              autoFocus={!account}
              value={email}
              invalid={!!emailError}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        {mode === 'create' && (
          <NewPasswordField value={password} onChange={setPassword} submitted={submitted} />
        )}
        {mode === 'signin' && (
          <Field
            label="Password"
            error={submitted && !password ? 'Enter your password.' : null}
            aside={
              <button
                type="button"
                onClick={() => go('forgot')}
                className="focus-ring rounded-2xs text-footnote text-accent-text hover:underline"
              >
                Forgot password?
              </button>
            }
          >
            {(id) => (
              <PasswordInput
                id={id}
                autoComplete="current-password"
                autoFocus={!!account}
                value={password}
                invalid={submitted && !password}
                onChange={setPassword}
              />
            )}
          </Field>
        )}
        <ErrorLine message={error ?? problem} />
        <SubmitButton busy={busy}>
          {mode === 'forgot'
            ? busy
              ? 'Sending…'
              : 'Send reset link'
            : mode === 'create'
              ? busy
                ? 'Creating account…'
                : 'Create account'
              : busy
                ? 'Signing in…'
                : 'Sign in'}
        </SubmitButton>
      </form>
    </LockFrame>
  );
}

/** Six boxes over one hidden input: typing, pasting and one-time-code autofill all work. */
function CodeBoxes({
  value,
  onChange,
  onComplete,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  invalid: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="relative mt-2 grid grid-cols-6 gap-2">
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const current = focused && i === Math.min(value.length, CODE_LENGTH - 1);
        return (
          <div
            key={i}
            aria-hidden="true"
            className={cn(
              'grid h-11 place-items-center rounded-md border bg-surface text-title-3 font-semibold tabular-nums',
              'transition-[box-shadow,border-color] duration-(--duration-fast)',
              invalid
                ? 'border-red-fill'
                : current
                  ? 'border-accent shadow-focus'
                  : 'border-line-2',
            )}
          >
            {value[i] ?? ''}
          </div>
        );
      })}
      <input
        ref={input}
        autoFocus
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        aria-label="Verification code"
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
          onChange(v);
          if (v.length === CODE_LENGTH) onComplete(v);
        }}
        className="app-no-drag absolute inset-0 size-full cursor-text opacity-0"
      />
    </div>
  );
}

/**
 * An email was sent. Sign-up: enter its code (or open its link on this computer). Reset: open
 * its link on this computer. Either can be sent again after a minute.
 */
export function CheckEmailScreen({
  email,
  purpose,
  problem,
  onDone,
}: {
  email: string;
  purpose: 'signup' | 'reset';
  problem: string | null;
  onDone: Done;
}) {
  const action = useAuthAction(onDone);
  const [code, setCode] = useState('');
  const back = () => action.run(() => window.radar.auth.cancel());

  if (purpose === 'reset') {
    return (
      <LockFrame back={{ label: 'Back to sign in', onClick: back }}>
        <Heading title="Check your email" icon={Mail}>
          A reset link is on its way to {email}. Open it on this computer to choose a new password.
        </Heading>
        <ErrorLine message={action.error ?? problem} />
        <SubmitButton busy={false} disabled={action.busy} onClick={back}>
          Back to sign in
        </SubmitButton>
        <Resend
          label="Resend link"
          onResend={() => window.radar.auth.requestReset(email).then(onDone)}
        />
      </LockFrame>
    );
  }

  const verify = (value: string) => {
    if (value.length === CODE_LENGTH && !action.busy) {
      action.run(() => window.radar.auth.confirmCode(value));
    }
  };

  return (
    <LockFrame back={{ label: 'Back', onClick: back }}>
      <Heading title="Verify your email" icon={Mail}>
        Radar sent a {CODE_LENGTH}-digit code to {email}. Enter it to finish creating your account,
        or open the link in that email on this computer.
      </Heading>
      <CodeBoxes
        value={code}
        onChange={(v) => {
          setCode(v);
          action.setError(null);
        }}
        onComplete={verify}
        invalid={!!action.error}
      />
      <div className="mt-2">
        <ErrorLine message={action.error ?? problem} />
      </div>
      <SubmitButton
        busy={action.busy}
        disabled={code.length < CODE_LENGTH}
        onClick={() => verify(code)}
      >
        {action.busy ? 'Verifying…' : 'Verify and continue'}
      </SubmitButton>
      <Resend label="Resend code" onResend={() => window.radar.auth.resendEmail()} />
    </LockFrame>
  );
}

/** Google sign-in is open in the browser. */
export function BrowserScreen({ onDone }: { onDone: Done }) {
  const { busy, error, run } = useAuthAction(onDone);
  return (
    <LockFrame>
      <Heading title="Continue in your browser" icon={Globe}>
        Sign in with Google in the browser tab that just opened. Radar continues by itself when you
        are done.
      </Heading>
      <ErrorLine message={error} />
      <Button
        size="xl"
        disabled={busy}
        className="mt-2 w-full"
        onClick={() => run(() => window.radar.auth.cancel())}
      >
        Cancel
      </Button>
    </LockFrame>
  );
}

/** First Google sign-in on this computer: the password that encrypts the data here. */
export function ChoosePasswordScreen({
  account,
  hasPlainData,
  onDone,
}: {
  account: AccountInfo;
  hasPlainData: boolean;
  onDone: Done;
}) {
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (newPasswordProblem(password)) return;
    run(() => window.radar.auth.choosePassword(password));
  };

  return (
    <LockFrame>
      <Heading title="Choose a Radar password">
        You signed in as {account.email} with Google. This password encrypts Radar’s data on this
        computer and opens it, even offline. It is not your Google password.
        {hasPlainData && ' Your existing data will be encrypted with it.'}
      </Heading>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <NewPasswordField
          label="Radar password"
          value={password}
          onChange={setPassword}
          submitted={submitted}
          autoFocus
        />
        <ErrorLine message={error} />
        <SubmitButton busy={busy}>
          {busy ? (hasPlainData ? 'Encrypting your data…' : 'Setting up…') : 'Continue'}
        </SubmitButton>
      </form>
    </LockFrame>
  );
}

/** Opened from the reset link: the new account password (and the recovery key for data here). */
export function NewPasswordScreen({
  account,
  hasData,
  onDone,
}: {
  account: AccountInfo;
  hasData: boolean;
  onDone: Done;
}) {
  const [recoveryKey, setRecoveryKey] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if ((hasData && !recoveryKey.trim()) || newPasswordProblem(password)) return;
    run(() => window.radar.auth.setNewPassword(password, recoveryKey));
  };

  return (
    <LockFrame>
      <Heading title="Choose a new password">
        For {account.email}.
        {hasData &&
          ' Your data on this computer is still encrypted with the old password: your recovery key re-encrypts it with the new one.'}
      </Heading>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        {hasData && (
          <RecoveryKeyField
            value={recoveryKey}
            onChange={setRecoveryKey}
            invalid={submitted && !recoveryKey.trim()}
            autoFocus
          />
        )}
        <NewPasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          submitted={submitted}
          autoFocus={!hasData}
        />
        <ErrorLine message={error} />
        <SubmitButton busy={busy}>{busy ? 'Saving…' : 'Save password and open Radar'}</SubmitButton>
      </form>
    </LockFrame>
  );
}

/** The account password changed elsewhere: the recovery key re-encrypts this computer's data. */
export function PasswordChangedScreen({ account, onDone }: { account: AccountInfo; onDone: Done }) {
  const [recoveryKey, setRecoveryKey] = useState('');
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (recoveryKey.trim()) run(() => window.radar.auth.finishPasswordChange(recoveryKey));
  };

  return (
    <LockFrame>
      <Heading title="Your password changed">
        The password for {account.email} was changed, maybe on another computer. Enter your recovery
        key once: it re-encrypts the data here with the new password.
      </Heading>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <RecoveryKeyField value={recoveryKey} onChange={setRecoveryKey} autoFocus />
        <ErrorLine message={error} />
        <SubmitButton busy={busy} disabled={!recoveryKey.trim()}>
          {busy ? 'Re-encrypting…' : 'Continue'}
        </SubmitButton>
      </form>
    </LockFrame>
  );
}

/**
 * First sign-in on another computer of an account that syncs: the account's recovery key opens
 * its data key here (once). Without it, Radar starts empty here and syncs once the key is entered
 * in Settings.
 */
export function JoinScreen({
  account,
  problem,
  onDone,
}: {
  account: AccountInfo;
  problem: string | null;
  onDone: Done;
}) {
  const [recoveryKey, setRecoveryKey] = useState('');
  const { busy, error, run } = useAuthAction(onDone);
  const skip = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (recoveryKey.trim()) run(() => window.radar.auth.join(recoveryKey));
  };

  return (
    <LockFrame
      footer={{
        question: 'Don’t have it here?',
        action: 'Start empty',
        onClick: () => skip.run(() => window.radar.auth.skipJoin()),
      }}
    >
      <Heading title="Bring your data here">
        {account.email} already syncs from another computer. Enter the recovery key you saved when
        you set it up: your data is encrypted with it, and the server cannot read it.
      </Heading>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <RecoveryKeyField value={recoveryKey} onChange={setRecoveryKey} autoFocus />
        <ErrorLine message={error ?? skip.error ?? problem} />
        <SubmitButton busy={busy} disabled={skip.busy || !recoveryKey.trim()}>
          {busy ? 'Opening your data…' : 'Continue'}
        </SubmitButton>
      </form>
    </LockFrame>
  );
}
