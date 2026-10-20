import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { posix, win32 } from 'node:path';
import { z } from 'zod';
import type { CopilotCheck } from '../../shared/ipc';

/**
 * Radar Copilot runs the user's own Claude Code CLI headless (`claude -p`), one process per
 * request: the prompt goes in on stdin, a JSON Schema built from a zod schema shapes the answer,
 * and the answer is validated again here. No tools, no MCP servers, no saved session.
 * Main process only: src/core never talks to an LLM.
 */

export type CopilotErrorCode =
  'not-found' | 'not-signed-in' | 'timeout' | 'failed' | 'invalid-output' | 'stopped';

export class CopilotError extends Error {
  constructor(
    readonly code: CopilotErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CopilotError';
  }
}

export interface FindDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  exists: (path: string) => boolean;
  readText: (path: string) => string;
}

const nodeFindDeps = (): FindDeps => ({
  env: process.env,
  platform: process.platform,
  home: homedir(),
  exists: existsSync,
  readText: (path) => readFileSync(path, 'utf8'),
});

/** PATH is spelled "Path" on Windows. */
function pathDirs(env: NodeJS.ProcessEnv, sep: string): string[] {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return (key ? (env[key] ?? '') : '').split(sep).filter(Boolean);
}

/**
 * npm's Windows shim (claude.cmd) only forwards to the real claude.exe. Node cannot spawn a .cmd
 * without a shell (and the JSON Schema argument would not survive cmd quoting), so read the
 * target out of the shim instead.
 */
export function shimTarget(cmdPath: string, text: string): string | null {
  const m = /"%dp0%\\([^"\r\n]{1,500}\.exe)"/i.exec(text);
  return m ? win32.join(win32.dirname(cmdPath), m[1]!) : null;
}

/** The claude executable: the configured path, else PATH, else the native installer's folder. */
export function findClaude(configured: string | null, deps: FindDeps = nodeFindDeps()): string {
  const win = deps.platform === 'win32';
  const { join } = win ? win32 : posix;
  const usable = (path: string): string | null => {
    if (!deps.exists(path)) return null;
    if (win && /\.cmd$/i.test(path)) {
      const target = shimTarget(path, deps.readText(path));
      return target && deps.exists(target) ? target : null;
    }
    return path;
  };

  if (configured) {
    const found = usable(configured);
    if (found) return found;
    throw new CopilotError('not-found', `Claude Code was not found at ${configured}`);
  }
  const names = win ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = [
    ...pathDirs(deps.env, win ? ';' : ':'),
    join(deps.home, '.local', 'bin'),
    join(deps.home, '.claude', 'local'),
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const found = usable(join(dir, name));
      if (found) return found;
    }
  }
  throw new CopilotError(
    'not-found',
    'Claude Code was not found. Install it, or set its path in Settings > Radar Copilot.',
  );
}

export interface ChildLike {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  on(event: 'error', fn: (err: Error) => void): unknown;
  on(event: 'close', fn: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type SpawnLike = (
  exe: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildLike;

const defaultSpawn: SpawnLike = (exe, args, { cwd, env }) =>
  nodeSpawn(exe, args, { cwd, env, windowsHide: true, stdio: 'pipe' });

/** Leaves Radar's own environment behind: a nested Claude Code session refuses to start. */
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE']) {
    delete out[key];
  }
  return out;
}

const MAX_OUTPUT = 10 * 1024 * 1024;

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(
  exe: string,
  args: string[],
  input: string,
  opts: { timeoutMs: number; spawn: SpawnLike; cwd: string; signal?: AbortSignal },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let child: ChildLike;
    try {
      child = opts.spawn(exe, args, { cwd: opts.cwd, env: childEnv(process.env) });
    } catch (err) {
      reject(new CopilotError('not-found', `Claude Code could not start: ${String(err)}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() =>
        reject(
          new CopilotError(
            'timeout',
            `Claude Code did not answer within ${opts.timeoutMs / 1000} s`,
          ),
        ),
      );
    }, opts.timeoutMs);
    const collect = (which: 'out' | 'err') => (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (which === 'out') stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > MAX_OUTPUT) {
        child.kill();
        finish(() => reject(new CopilotError('failed', 'Claude Code sent more than 10 MB')));
      }
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));
    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'failed';
      finish(() => reject(new CopilotError(code, `Claude Code could not start: ${err.message}`)));
    });
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })));
    child.stdin.on('error', () => {}); // a process that exits early closes stdin; 'close' reports it
    const onAbort = () => {
      child.kill();
      finish(() => reject(new CopilotError('stopped', 'Stopped')));
    };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin.end(input);
  });
}

/** What `claude -p --output-format json` prints (only the fields Radar reads). */
const envelopeSchema = z.object({
  type: z.literal('result'),
  is_error: z.boolean(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
});

const SIGNED_OUT = /\/login|not logged in|log ?in to|invalid api key|authenticat/i;

function tail(text: string): string {
  const t = text.trim();
  return t.length > 300 ? `…${t.slice(-300)}` : t;
}

export interface RunResult<T> {
  value: T;
  costUsd: number | null;
  durationMs: number | null;
}

/** Turns the CLI's output into a validated answer, or a CopilotError that says what went wrong. */
export function readResult<T>(out: ProcessResult, schema: z.ZodType<T>): RunResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(out.stdout);
  } catch {
    const said = tail(out.stderr || out.stdout) || `exit code ${String(out.code)}`;
    if (SIGNED_OUT.test(said)) {
      throw new CopilotError('not-signed-in', `Claude Code is not signed in: ${said}`);
    }
    throw new CopilotError('failed', `Claude Code failed: ${said}`);
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new CopilotError('invalid-output', 'Claude Code printed something Radar does not know');
  }
  const e = envelope.data;
  if (e.is_error) {
    const said = tail(e.result ?? out.stderr) || (e.subtype ?? 'unknown error');
    if (SIGNED_OUT.test(said)) {
      throw new CopilotError('not-signed-in', `Claude Code is not signed in: ${said}`);
    }
    throw new CopilotError('failed', `Claude Code failed: ${said}`);
  }
  const value = schema.safeParse(e.structured_output);
  if (!value.success) {
    throw new CopilotError(
      'invalid-output',
      `Claude Code's answer did not match the expected shape:\n${z.prettifyError(value.error)}`,
    );
  }
  return {
    value: value.data,
    costUsd: e.total_cost_usd ?? null,
    durationMs: e.duration_ms ?? null,
  };
}

export interface RunOptions<T> {
  exe: string;
  prompt: string;
  schema: z.ZodType<T>;
  model: string;
  /** Kills the process and rejects with code 'stopped'. */
  signal?: AbortSignal;
  /** Default 5 minutes. */
  timeoutMs?: number;
  /** Working folder for the CLI (kept outside any project so no CLAUDE.md is picked up). */
  cwd?: string;
  spawn?: SpawnLike;
}

/**
 * The CLI validates --json-schema with a draft-07 validator: it refuses zod's default 2020-12
 * output, and a "$schema" key naming any draft it has not loaded.
 */
export function cliJsonSchema(schema: z.ZodType): string {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: 'draft-7' });
  return JSON.stringify(rest);
}

/** One headless request with a structured answer. */
export async function runClaude<T>(opts: RunOptions<T>): Promise<RunResult<T>> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    cliJsonSchema(opts.schema),
    '--tools',
    '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--model',
    opts.model,
  ];
  const out = await runProcess(opts.exe, args, opts.prompt, {
    timeoutMs: opts.timeoutMs ?? 5 * 60_000,
    spawn: opts.spawn ?? defaultSpawn,
    cwd: opts.cwd ?? tmpdir(),
    signal: opts.signal,
  });
  return readResult(out, opts.schema);
}

const pingSchema = z.strictObject({ ok: z.boolean() });

export interface CheckDeps {
  find?: (configured: string | null) => string;
  spawn?: SpawnLike;
  cwd?: string;
}

/** Settings > Check: finds the CLI, reads its version, then makes one tiny real request. */
export async function checkClaude(
  settings: { claudePath: string | null; model: string },
  deps: CheckDeps = {},
): Promise<CopilotCheck> {
  try {
    const exe = (deps.find ?? findClaude)(settings.claudePath);
    const spawn = deps.spawn ?? defaultSpawn;
    const cwd = deps.cwd ?? tmpdir();
    const version = await runProcess(exe, ['--version'], '', { timeoutMs: 30_000, spawn, cwd });
    if (version.code !== 0) {
      throw new CopilotError('failed', `claude --version failed: ${tail(version.stderr)}`);
    }
    const ping = await runClaude({
      exe,
      prompt: 'Reply with ok set to true.',
      schema: pingSchema,
      model: settings.model,
      timeoutMs: 2 * 60_000,
      spawn,
      cwd,
    });
    if (!ping.value.ok) throw new CopilotError('invalid-output', 'Claude Code answered no');
    return {
      ok: true,
      path: exe,
      version: version.stdout.trim().split(/\r?\n/)[0] ?? '',
      durationMs: ping.durationMs,
    };
  } catch (err) {
    if (err instanceof CopilotError) return { ok: false, code: err.code, problem: err.message };
    throw err;
  }
}
