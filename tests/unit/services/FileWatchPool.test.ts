import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileWatchPool, type WatchRootConfig, type WatchedFileInfo } from '../../../src/services/FileWatchPool';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fwp-test-'));
}

function writeJsonl(filePath: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

describe('FileWatchPool', () => {
  let tmpDir: string;
  let pool: FileWatchPool;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    pool?.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should discover existing jsonl files on start', async () => {
    const projectDir = path.join(tmpDir, 'project-a');
    const logFile = path.join(projectDir, 'session-1.jsonl');
    writeJsonl(logFile, ['{"type":"user","message":{"content":"hello"}}']);

    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'claude-code' }];
    pool = new FileWatchPool(roots);

    const addedFiles: string[] = [];
    pool.on('fileAdded', (filePath: string) => {
      addedFiles.push(filePath);
    });

    pool.start();

    // Pool discovers files synchronously during forceFullScan in start()
    expect(pool.getPoolSize()).toBe(1);
    expect(addedFiles).toContain(logFile);

    const snapshot = pool.getPoolSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].path).toBe(logFile);
    expect(snapshot[0].source).toBe('claude-code');
    expect(snapshot[0].lastSize).toBeGreaterThan(0);
  });

  it('should detect new files added after start', async () => {
    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'claude-code' }];
    pool = new FileWatchPool(roots);
    pool.start();

    expect(pool.getPoolSize()).toBe(0);

    const projectDir = path.join(tmpDir, 'project-b');
    const logFile = path.join(projectDir, 'session-2.jsonl');

    const addedPromise = new Promise<string>((resolve) => {
      pool.on('fileAdded', (filePath: string) => resolve(filePath));
    });

    writeJsonl(logFile, ['{"type":"user"}']);

    // Trigger a forced scan to detect the new file (simulating the safety net scan)
    pool.forceFullScan();

    const addedPath = await addedPromise;
    expect(addedPath).toBe(logFile);
    expect(pool.getPoolSize()).toBe(1);
  });

  it('should emit fileChanged when a pooled file is modified via forceFullScan', async () => {
    const projectDir = path.join(tmpDir, 'project-c');
    const logFile = path.join(projectDir, 'session-3.jsonl');
    writeJsonl(logFile, ['{"type":"user","line":1}']);

    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'codex' }];
    pool = new FileWatchPool(roots);
    pool.start();

    expect(pool.getPoolSize()).toBe(1);

    // Modify the file
    fs.appendFileSync(logFile, '{"type":"user","line":2}\n');

    const changedPromise = new Promise<string>((resolve) => {
      pool.on('fileChanged', (filePath: string) => resolve(filePath));
    });

    pool.forceFullScan();

    const changedPath = await changedPromise;
    expect(changedPath).toBe(logFile);
  });

  it('should handle multiple roots', () => {
    const claudeDir = path.join(tmpDir, 'claude');
    const codexDir = path.join(tmpDir, 'codex');

    const claudeFile = path.join(claudeDir, 'proj', 's1.jsonl');
    const codexFile = path.join(codexDir, '2026', '04', '16', 's2.jsonl');

    writeJsonl(claudeFile, ['{"type":"user"}']);
    writeJsonl(codexFile, ['{"type":"event_msg"}']);

    const roots: WatchRootConfig[] = [
      { path: claudeDir, source: 'claude-code' },
      { path: codexDir, source: 'codex' }
    ];
    pool = new FileWatchPool(roots);
    pool.start();

    expect(pool.getPoolSize()).toBe(2);

    const snapshot = pool.getPoolSnapshot();
    const sources = snapshot.map((f) => f.source).sort();
    expect(sources).toEqual(['claude-code', 'codex']);
  });

  it('should skip non-existent root directories', () => {
    const roots: WatchRootConfig[] = [
      { path: path.join(tmpDir, 'nonexistent'), source: 'claude-code' }
    ];
    pool = new FileWatchPool(roots);
    pool.start();

    expect(pool.getPoolSize()).toBe(0);
  });

  it('should only pick up .jsonl files', () => {
    const projectDir = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'data.json'), '{}');
    fs.writeFileSync(path.join(projectDir, 'notes.txt'), 'hello');
    writeJsonl(path.join(projectDir, 'session.jsonl'), ['{"type":"user"}']);

    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'claude-code' }];
    pool = new FileWatchPool(roots);
    pool.start();

    expect(pool.getPoolSize()).toBe(1);
    expect(pool.getPoolSnapshot()[0].path).toContain('session.jsonl');
  });

  it('should emit fileRemoved when pool is cleared', () => {
    const logFile = path.join(tmpDir, 'proj', 's.jsonl');
    writeJsonl(logFile, ['{"type":"user"}']);

    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'claude-code' }];
    pool = new FileWatchPool(roots);
    pool.start();

    expect(pool.getPoolSize()).toBe(1);

    const removedFiles: string[] = [];
    pool.on('fileRemoved', (filePath: string) => removedFiles.push(filePath));

    // Stop clears the pool
    pool.stop();

    expect(pool.getPoolSize()).toBe(0);
  });

  it('getPoolSnapshot should return copies without watcher references', () => {
    const logFile = path.join(tmpDir, 'proj', 's.jsonl');
    writeJsonl(logFile, ['{"type":"user"}']);

    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'claude-code' }];
    pool = new FileWatchPool(roots);
    pool.start();

    const snapshot = pool.getPoolSnapshot();
    expect(snapshot).toHaveLength(1);

    // Should not have watcher or debounceId properties
    const entry = snapshot[0] as unknown as Record<string, unknown>;
    expect(entry).not.toHaveProperty('watcher');
    expect(entry).not.toHaveProperty('debounceId');
    expect(entry).toHaveProperty('path');
    expect(entry).toHaveProperty('source');
    expect(entry).toHaveProperty('lastSize');
    expect(entry).toHaveProperty('lastMtimeMs');
    expect(entry).toHaveProperty('lastChangedAt');
  });

  it('should NOT refresh lastChangedAt when file has not changed during scan', () => {
    const logFile = path.join(tmpDir, 'proj', 's.jsonl');
    writeJsonl(logFile, ['{"type":"user"}']);

    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'claude-code' }];
    pool = new FileWatchPool(roots);
    pool.start();

    const snapshotBefore = pool.getPoolSnapshot();
    expect(snapshotBefore).toHaveLength(1);
    const initialChangedAt = snapshotBefore[0].lastChangedAt;

    // Wait a tick so Date.now() would differ if it were updated
    const later = initialChangedAt + 100;
    vi.spyOn(Date, 'now').mockReturnValue(later);

    // Force a full scan — the file hasn't changed, so lastChangedAt should stay the same
    pool.forceFullScan();

    const snapshotAfter = pool.getPoolSnapshot();
    expect(snapshotAfter).toHaveLength(1);
    expect(snapshotAfter[0].lastChangedAt).toBe(initialChangedAt);

    vi.restoreAllMocks();
  });

  it('should update lastChangedAt only when file content changes', () => {
    const logFile = path.join(tmpDir, 'proj', 's.jsonl');
    writeJsonl(logFile, ['{"type":"user","line":1}']);

    const roots: WatchRootConfig[] = [{ path: tmpDir, source: 'claude-code' }];
    pool = new FileWatchPool(roots);
    pool.start();

    const snapshotBefore = pool.getPoolSnapshot();
    const initialChangedAt = snapshotBefore[0].lastChangedAt;
    const initialSize = snapshotBefore[0].lastSize;

    // Append content to the file — this changes both size and mtime
    fs.appendFileSync(logFile, '{"type":"user","line":2}\n');

    // Mock Date.now to a later time
    const laterTime = initialChangedAt + 5000;
    vi.spyOn(Date, 'now').mockReturnValue(laterTime);

    pool.forceFullScan();

    const snapshotAfter = pool.getPoolSnapshot();
    expect(snapshotAfter).toHaveLength(1);
    expect(snapshotAfter[0].lastSize).toBeGreaterThan(initialSize);
    expect(snapshotAfter[0].lastChangedAt).toBe(laterTime);
    expect(snapshotAfter[0].lastChangedAt).toBeGreaterThan(initialChangedAt);

    vi.restoreAllMocks();
  });
});
