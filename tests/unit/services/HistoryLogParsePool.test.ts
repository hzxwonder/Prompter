import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogSessionScanEntry } from '../../../src/services/LogParser';
import { HistoryLogParsePool } from '../../../src/services/HistoryLogParsePool';

class FakeChildProcess extends EventEmitter {
  public readonly send = vi.fn((message: { id: number; entry: LogSessionScanEntry }) => {
    setTimeout(() => {
      this.emit('message', {
        type: 'scan:result',
        id: message.id,
        prompts: [
          {
            source: message.entry.source,
            sessionId: message.entry.sessionId,
            sourceRef: `${message.entry.sessionId}:turn-1`,
            project: message.entry.sessionId,
            userInput: `parsed:${message.entry.path}`,
            createdAt: `${message.entry.dateBucket}T10:00:00.000Z`
          }
        ]
      });
    }, 0);
    return true;
  });

  public readonly kill = vi.fn(() => true);
}

describe('HistoryLogParsePool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses multiple history entries concurrently across child processes', async () => {
    const workers = [new FakeChildProcess(), new FakeChildProcess()];
    const forkProcess = vi
      .fn()
      .mockImplementationOnce(() => workers[0])
      .mockImplementationOnce(() => workers[1]);

    const pool = new HistoryLogParsePool({
      size: 2,
      workerScriptPath: '/tmp/logParserWorker.js',
      forkProcess
    });

    const entryA: LogSessionScanEntry = {
      source: 'codex',
      sessionId: 'session-a',
      path: '/tmp/a.jsonl',
      dateBucket: '2026-04-15',
      lastModifiedMs: Date.now()
    };
    const entryB: LogSessionScanEntry = {
      source: 'codex',
      sessionId: 'session-b',
      path: '/tmp/b.jsonl',
      dateBucket: '2026-04-15',
      lastModifiedMs: Date.now()
    };

    const [resultA, resultB] = await Promise.all([
      pool.scanEntry(entryA),
      pool.scanEntry(entryB)
    ]);

    expect(forkProcess).toHaveBeenCalledTimes(2);
    expect(workers[0].send).toHaveBeenCalledTimes(1);
    expect(workers[1].send).toHaveBeenCalledTimes(1);
    expect(resultA).toEqual([
      expect.objectContaining({
        sessionId: 'session-a',
        userInput: 'parsed:/tmp/a.jsonl'
      })
    ]);
    expect(resultB).toEqual([
      expect.objectContaining({
        sessionId: 'session-b',
        userInput: 'parsed:/tmp/b.jsonl'
      })
    ]);

    await pool.dispose();

    expect(workers[0].kill).toHaveBeenCalledTimes(1);
    expect(workers[1].kill).toHaveBeenCalledTimes(1);
  });
});
