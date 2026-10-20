import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  checkClaude,
  CopilotError,
  findClaude,
  readResult,
  runClaude,
  shimTarget,
  type ChildLike,
  type FindDeps,
  type SpawnLike,
} from '../src/main/copilot/claude';
import { checkLine, cvLine } from '../src/renderer/src/lib/copilot';

const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*
`;

function winFs(files: Record<string, string>, env: NodeJS.ProcessEnv = {}): FindDeps {
  const lower = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    env,
    platform: 'win32',
    home: 'C:\\Users\\me',
    exists: (p) => p.toLowerCase() in lower,
    readText: (p) => lower[p.toLowerCase()] ?? '',
  };
}

describe('findClaude', () => {
  const exe = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';

  it('reads the real exe out of the npm shim', () => {
    expect(shimTarget('C:\\npm\\claude.cmd', NPM_SHIM)).toBe(exe);
  });

  it('finds the shim on PATH (spelled Path on Windows) and follows it', () => {
    const deps = winFs({ 'C:\\npm\\claude.cmd': NPM_SHIM, [exe]: '' }, { Path: 'C:\\x;C:\\npm' });
    expect(findClaude(null, deps)).toBe(exe);
  });

  it('prefers claude.exe and falls back to the native installer folder', () => {
    expect(findClaude(null, winFs({ 'C:\\bin\\claude.exe': '' }, { PATH: 'C:\\bin' }))).toBe(
      'C:\\bin\\claude.exe',
    );
    expect(findClaude(null, winFs({ 'C:\\Users\\me\\.local\\bin\\claude.exe': '' }))).toBe(
      'C:\\Users\\me\\.local\\bin\\claude.exe',
    );
  });

  it('uses a configured path, and says so when it is wrong', () => {
    const deps = winFs({ 'D:\\tools\\claude.exe': '' });
    expect(findClaude('D:\\tools\\claude.exe', deps)).toBe('D:\\tools\\claude.exe');
    expect(() => findClaude('D:\\nope.exe', deps)).toThrow(/not found at D:\\nope.exe/);
  });

  it('reports not-found when nothing is installed', () => {
    try {
      findClaude(null, winFs({}, { PATH: 'C:\\bin' }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CopilotError);
      expect((err as CopilotError).code).toBe('not-found');
    }
  });

  it('searches PATH with ":" on macOS and Linux', () => {
    const deps: FindDeps = {
      env: { PATH: '/usr/bin:/opt/claude' },
      platform: 'darwin',
      home: '/Users/me',
      exists: (p) => p === '/opt/claude/claude',
      readText: () => '',
    };
    expect(findClaude(null, deps)).toBe('/opt/claude/claude');
  });
});

const answer = z.strictObject({ ok: z.boolean() });
const envelope = (fields: Record<string, unknown>) =>
  JSON.stringify({ type: 'result', is_error: false, ...fields });

describe('readResult', () => {
  it('returns the structured answer with cost and duration', () => {
    const out = {
      code: 0,
      stderr: '',
      stdout: envelope({
        structured_output: { ok: true },
        total_cost_usd: 0.01,
        duration_ms: 2862,
      }),
    };
    expect(readResult(out, answer)).toEqual({
      value: { ok: true },
      costUsd: 0.01,
      durationMs: 2862,
    });
  });

  it('tells a signed-out CLI apart from other failures', () => {
    const signedOut = {
      code: 1,
      stderr: '',
      stdout: envelope({ is_error: true, result: 'Invalid API key · Please run /login' }),
    };
    expect(() => readResult(signedOut, answer)).toThrow(
      expect.objectContaining({ code: 'not-signed-in' }),
    );
    const broken = {
      code: 1,
      stderr: '',
      stdout: envelope({ is_error: true, result: 'Overloaded' }),
    };
    expect(() => readResult(broken, answer)).toThrow(expect.objectContaining({ code: 'failed' }));
    const noJson = { code: 2, stdout: '', stderr: 'error: unknown option' };
    expect(() => readResult(noJson, answer)).toThrow(/unknown option/);
  });

  it('refuses an answer of the wrong shape', () => {
    const out = { code: 0, stderr: '', stdout: envelope({ structured_output: { ok: 'yes' } }) };
    expect(() => readResult(out, answer)).toThrow(
      expect.objectContaining({ code: 'invalid-output' }),
    );
  });
});

/** A child process that records its stdin and answers with `stdout` when stdin ends. */
function fakeSpawn(reply: (args: string[]) => { stdout: string; code: number } | 'hang') {
  const calls: { exe: string; args: string[]; stdin: string; env: NodeJS.ProcessEnv }[] = [];
  const spawn: SpawnLike = (exe, args, { env }) => {
    const child = new EventEmitter() as EventEmitter & ChildLike;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr: new PassThrough(), kill: vi.fn() });
    const call = { exe, args, stdin: '', env };
    calls.push(call);
    stdin.on('data', (c: Buffer) => (call.stdin += c.toString()));
    stdin.on('end', () => {
      const r = reply(args);
      if (r === 'hang') return;
      stdout.end(r.stdout);
      stdout.on('end', () => child.emit('close', r.code));
      stdout.resume();
    });
    return child;
  };
  return { spawn, calls };
}

describe('runClaude', () => {
  it('runs headless with no tools, a JSON Schema, and the prompt on stdin', async () => {
    const { spawn, calls } = fakeSpawn(() => ({
      code: 0,
      stdout: envelope({ structured_output: { ok: true } }),
    }));
    vi.stubEnv('CLAUDECODE', '1');
    const r = await runClaude({
      exe: 'claude',
      prompt: 'Hello',
      schema: answer,
      model: 'sonnet',
      spawn,
    });
    vi.unstubAllEnvs();
    expect(r.value).toEqual({ ok: true });
    const [call] = calls;
    expect(call!.stdin).toBe('Hello');
    expect(call!.args).toEqual(
      expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config']),
    );
    expect(call!.args[call!.args.indexOf('--tools') + 1]).toBe('');
    expect(call!.args[call!.args.indexOf('--model') + 1]).toBe('sonnet');
    const schema = JSON.parse(call!.args[call!.args.indexOf('--json-schema') + 1]!) as {
      properties: object;
    };
    expect(schema.properties).toHaveProperty('ok');
    expect(schema).not.toHaveProperty('$schema'); // the CLI refuses drafts it has not loaded
    expect(call!.env['CLAUDECODE']).toBeUndefined(); // a nested session would refuse to start
  });

  it('gives up after the timeout and kills the process', async () => {
    const { spawn } = fakeSpawn(() => 'hang');
    await expect(
      runClaude({
        exe: 'claude',
        prompt: 'x',
        schema: answer,
        model: 'sonnet',
        spawn,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('checkClaude', () => {
  it('reports the version and how long the tiny request took', async () => {
    const { spawn } = fakeSpawn((args) =>
      args[0] === '--version'
        ? { code: 0, stdout: '2.1.303 (Claude Code)\n' }
        : { code: 0, stdout: envelope({ structured_output: { ok: true }, duration_ms: 2900 }) },
    );
    const r = await checkClaude(
      { claudePath: null, model: 'sonnet' },
      { find: () => 'claude', spawn },
    );
    expect(r).toEqual({
      ok: true,
      path: 'claude',
      version: '2.1.303 (Claude Code)',
      durationMs: 2900,
    });
    expect(checkLine(r)).toBe('2.1.303 (Claude Code) · answered in 2.9 s');
  });

  it('turns a missing CLI into a problem, not an exception', async () => {
    const r = await checkClaude(
      { claudePath: null, model: 'sonnet' },
      {
        find: () => {
          throw new CopilotError('not-found', 'nope');
        },
      },
    );
    expect(r).toEqual({ ok: false, code: 'not-found', problem: 'nope' });
    expect(checkLine(r)).toMatch(/^Not found/);
  });
});

describe('cvLine', () => {
  it('counts words', () => {
    expect(cvLine('  ')).toMatch(/^Paste your full CV/);
    expect(cvLine('Jane Doe\nPython, TypeScript')).toMatch(/^4 words/);
  });
});
