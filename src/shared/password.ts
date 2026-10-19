// Password rules, shared by the vault (main, CLI) and the lock screen. No Node or DOM imports.

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

/** For a new password typed twice: the first problem to show, or null. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  return passwordProblem(password) ?? (password === confirm ? null : 'The passwords do not match');
}
