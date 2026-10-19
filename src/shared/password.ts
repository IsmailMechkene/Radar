// Password rules, shared by the vault (main, CLI) and the lock screen. No Node or DOM imports.

/** What any password must meet (unlock, CLI, the vault): passwords set before stay valid. */
export const PASSWORD_MIN = 8;
/** bcrypt, used by the account service, reads at most 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

/** Why a password cannot be used, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Use at most ${PASSWORD_MAX_BYTES} bytes (fewer accented letters or symbols)`;
  }
  return null;
}

/** A newly chosen password (sign-up, setup, reset) must also meet these, shown as a checklist. */
export const NEW_PASSWORD_MIN = 10;

export interface PasswordCheck {
  label: string;
  met: boolean;
}

export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { label: `${NEW_PASSWORD_MIN}+ characters`, met: password.length >= NEW_PASSWORD_MIN },
    {
      label: 'Upper and lower case',
      met: /\p{Ll}/u.test(password) && /\p{Lu}/u.test(password),
    },
    { label: 'Number or symbol', met: /[^\p{L}\s]/u.test(password) },
  ];
}

/** 0 to 4: one step per check met, 4 when all are met and it is 14+ characters. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  const met = passwordChecks(password).filter((c) => c.met).length as 0 | 1 | 2 | 3;
  return met === 3 && password.length >= 14 ? 4 : met;
}

export const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/** For a newly chosen password: the first problem to show, or null. */
export function newPasswordProblem(password: string): string | null {
  return (
    passwordProblem(password) ??
    (passwordChecks(password).every((c) => c.met) ? null : 'Meet all three requirements below')
  );
}
