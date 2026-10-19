import { useState, type FormEvent } from 'react';
import type { AccountInfo, AuthStatus } from '../../../shared/ipc';
import { newPasswordProblem } from '../../../shared/password';
import { GoogleMark } from '../../components/Brand';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/Input';
import {
  ErrorLine,
  Field,
  Heading,
  LockFrame,
  NewPasswordFields,
  Step,
  TopLink,
  useAuthAction,
} from './LockScreens';

type Done = (s: AuthStatus) => void;

/** "Continue with Google": secondary, full width, Google's mark (Google's branding rules). */
function GoogleButton({ onDone }: { onDone: Done }) {
  const { busy, error, run } = useAuthAction(onDone);
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        disabled={busy}
        className="w-full gap-2"
        onClick={() => run(() => window.radar.auth.google())}
      >
        <GoogleMark />
        {busy ? 'Opening your browser…' : 'Continue with Google'}
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}

function Or() {
  return (
    <div className="my-1 flex items-center gap-3 text-footnote text-fg-3" aria-hidden="true">
      <span className="h-px flex-1 hairline-t border-line" />
      or
      <span className="h-px flex-1 hairline-t border-line" />
    </div>
  );
}

function RecoveryKeyField({
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
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, setError, run } = useAuthAction(onDone);
  const canCreate = purpose !== 'again';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const go = (next: typeof mode) => {
    setMode(next);
    setSubmitted(false);
    setConfirm('');
    setError(null); // an error belongs to the form it came from
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!emailOk) return;
    const address = email.trim();
    if (mode === 'forgot') return run(() => window.radar.auth.requestReset(address));
    if (mode === 'create') {
      if (newPasswordProblem(password, confirm)) return;
      return run(() => window.radar.auth.createAccount(address, password));
    }
    if (password) run(() => window.radar.auth.signIn(address, password));
  };

  const topRight =
    mode === 'forgot' ? (
      <TopLink question="Remember it?" action="Sign in" onClick={() => go('signin')} />
    ) : mode === 'create' ? (
      <TopLink question="Have an account?" action="Sign in" onClick={() => go('signin')} />
    ) : canCreate ? (
      <TopLink question="New to Radar?" action="Create account" onClick={() => go('create')} />
    ) : undefined;

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
      ? 'Radar emails you a link. Open it on this computer to choose a new password.'
      : purpose === 'connect'
        ? 'Radar now works with an account. Sign in or create one; your data on this computer stays encrypted and is linked to it.'
        : purpose === 'again' && account
          ? `Radar's data on this computer belongs to ${account.email}. Sign in with that account.`
          : mode === 'create'
            ? `With an email account, its password also encrypts Radar's data on this computer.${hasPlainData ? ' Your existing data will be encrypted too.' : ''}`
            : 'Welcome. Sign in to open Radar on this computer.';

  return (
    <LockFrame topRight={topRight}>
      <Heading title={title}>{intro}</Heading>
      <div className="flex flex-col gap-3.5">
        {mode !== 'forgot' && (
          <>
            <GoogleButton onDone={onDone} />
            <Or />
          </>
        )}
        <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
          <Field label="Email">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                autoComplete="email"
                autoFocus={!account}
                value={email}
                invalid={submitted && !emailOk}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          {mode === 'create' && (
            <NewPasswordFields
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
              showProblem={submitted || confirm.length > 0}
            />
          )}
          {mode === 'signin' && (
            <div className="flex flex-col gap-1.5">
              <Field label="Password">
                {(id) => (
                  <TextInput
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    autoFocus={!!account}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
              <Button
                variant="plain"
                size="sm"
                className="self-end px-0"
                onClick={() => go('forgot')}
              >
                Forgot password?
              </Button>
            </div>
          )}
          <ErrorLine message={error ?? problem} />
          <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
            {mode === 'forgot'
              ? busy
                ? 'Sending…'
                : 'Send reset link'
              : mode === 'create'
                ? busy
                  ? 'Creating your account…'
                  : 'Create account'
                : busy
                  ? 'Signing in…'
                  : 'Sign in'}
          </Button>
        </form>
      </div>
    </LockFrame>
  );
}

/** A link was emailed: confirm the address (sign-up) or reset the password. */
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
  const [resent, setResent] = useState(false);
  return (
    <LockFrame
      topRight={
        <TopLink
          question={purpose === 'signup' ? 'Wrong address?' : 'Remember it?'}
          action={purpose === 'signup' ? 'Use another email' : 'Back to sign in'}
          onClick={() => action.run(() => window.radar.auth.cancel())}
        />
      }
    >
      <Heading title="Check your email">
        {purpose === 'signup'
          ? `Radar sent a confirmation link to ${email}. Open it on this computer and Radar continues by itself.`
          : `Radar sent a reset link to ${email}. Open it on this computer to choose a new password.`}
      </Heading>
      <div className="flex flex-col gap-3.5">
        <ErrorLine message={action.error ?? problem} />
        {purpose === 'signup' && (
          <>
            <Button
              variant="primary"
              size="lg"
              disabled={action.busy}
              className="w-full"
              onClick={() => action.run(() => window.radar.auth.emailConfirmed())}
            >
              I’ve confirmed my email
            </Button>
            <Button
              size="lg"
              disabled={action.busy || resent}
              className="w-full"
              onClick={() =>
                action.run(async () => {
                  const s = await window.radar.auth.resendEmail();
                  setResent(true);
                  return s;
                })
              }
            >
              {resent ? 'Sent again' : 'Send the email again'}
            </Button>
          </>
        )}
        <p className="text-footnote leading-normal text-fg-3">
          Opened it on your phone? The link has to come back to this computer: open the email here
          instead.
        </p>
      </div>
    </LockFrame>
  );
}

/** Google sign-in is open in the browser. */
export function BrowserScreen({ onDone }: { onDone: Done }) {
  const { busy, error, run } = useAuthAction(onDone);
  return (
    <LockFrame>
      <Heading title="Continue in your browser">
        Sign in with Google in the browser tab that just opened. Radar continues by itself when you
        are done.
      </Heading>
      <div className="flex flex-col gap-3.5">
        <ErrorLine message={error} />
        <Button
          size="lg"
          disabled={busy}
          className="w-full"
          onClick={() => run(() => window.radar.auth.cancel())}
        >
          Cancel
        </Button>
      </div>
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
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (newPasswordProblem(password, confirm)) return;
    run(() => window.radar.auth.choosePassword(password));
  };

  return (
    <LockFrame topRight={<Step n={1} />}>
      <Heading title="Choose a Radar password">
        You signed in as {account.email} with Google. This password encrypts Radar’s data on this
        computer and opens it, even offline. It is not your Google password.
        {hasPlainData && ' Your existing data will be encrypted with it.'}
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
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, error, run } = useAuthAction(onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if ((hasData && !recoveryKey.trim()) || newPasswordProblem(password, confirm)) return;
    run(() => window.radar.auth.setNewPassword(password, recoveryKey));
  };

  return (
    <LockFrame>
      <Heading title="Choose a new password">
        For {account.email}.
        {hasData &&
          ' Your data on this computer is still encrypted with the old password: your recovery key re-encrypts it with the new one.'}
      </Heading>
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        {hasData && (
          <RecoveryKeyField
            value={recoveryKey}
            onChange={setRecoveryKey}
            invalid={submitted && !recoveryKey.trim()}
            autoFocus
          />
        )}
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          showProblem={submitted || confirm.length > 0}
          autoFocus={!hasData}
        />
        <ErrorLine message={error} />
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-1 w-full">
          {busy ? 'Saving…' : 'Save password and open Radar'}
        </Button>
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
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <RecoveryKeyField value={recoveryKey} onChange={setRecoveryKey} autoFocus />
        <ErrorLine message={error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={busy || !recoveryKey.trim()}
          className="mt-1 w-full"
        >
          {busy ? 'Re-encrypting…' : 'Continue'}
        </Button>
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
      topRight={
        <TopLink
          question="Don't have it here?"
          action="Start empty"
          onClick={() => skip.run(() => window.radar.auth.skipJoin())}
        />
      }
    >
      <Heading title="Bring your data here">
        {account.email} already syncs from another computer. Enter the recovery key you saved when
        you set it up: your data is encrypted with it, and the server cannot read it.
      </Heading>
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <RecoveryKeyField value={recoveryKey} onChange={setRecoveryKey} autoFocus />
        <ErrorLine message={error ?? skip.error ?? problem} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={busy || skip.busy || !recoveryKey.trim()}
          className="mt-1 w-full"
        >
          {busy ? 'Opening your data…' : 'Continue'}
        </Button>
      </form>
    </LockFrame>
  );
}
