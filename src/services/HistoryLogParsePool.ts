import { fork, type ChildProcess } from 'node:child_process';
import type { LogSessionScanEntry, ParsedPromptRecord } from './LogParser';

interface ScanRequestMessage {
  id: number;
  entry: LogSessionScanEntry;
}

interface ScanResultMessage {
  type: 'scan:result';
  id: number;
  prompts: ParsedPromptRecord[];
}

interface ScanErrorMessage {
  type: 'scan:error';
  id: number;
  error: string;
}

type WorkerMessage = ScanResultMessage | ScanErrorMessage;

interface PendingScan {
  id: number;
  entry: LogSessionScanEntry;
  resolve: (value: ParsedPromptRecord[]) => void;
  reject: (reason?: unknown) => void;
}

interface WorkerSlot {
  process: ChildProcess;
  activeRequest?: PendingScan;
}

export class HistoryLogParsePool {
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: PendingScan[] = [];
  private nextRequestId = 1;
  private disposed = false;

  constructor(
    private readonly options: {
      size: number;
      workerScriptPath: string;
      forkProcess?: typeof fork;
    }
  ) {
    const forkProcess = this.options.forkProcess ?? fork;
    for (let index = 0; index < this.options.size; index += 1) {
      this.workers.push(this.createWorkerSlot(forkProcess));
    }
  }

  async scanEntry(entry: LogSessionScanEntry): Promise<ParsedPromptRecord[]> {
    if (this.disposed) {
      throw new Error('HistoryLogParsePool has been disposed');
    }

    return new Promise<ParsedPromptRecord[]>((resolve, reject) => {
      this.queue.push({
        id: this.nextRequestId++,
        entry,
        resolve,
        reject
      });
      this.dispatch();
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;

    for (const slot of this.workers) {
      slot.activeRequest?.reject(new Error('HistoryLogParsePool has been disposed'));
      slot.activeRequest = undefined;
      slot.process.kill();
    }

    while (this.queue.length > 0) {
      this.queue.shift()?.reject(new Error('HistoryLogParsePool has been disposed'));
    }
  }

  private createWorkerSlot(forkProcess: typeof fork): WorkerSlot {
    const child = forkProcess(this.options.workerScriptPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    const slot: WorkerSlot = { process: child };

    child.on('message', (message: WorkerMessage) => {
      if (!slot.activeRequest) {
        return;
      }

      const request = slot.activeRequest;
      if (message.id !== request.id) {
        return;
      }

      slot.activeRequest = undefined;
      if (message.type === 'scan:error') {
        request.reject(new Error(message.error));
      } else {
        request.resolve(message.prompts);
      }
      this.dispatch();
    });

    child.on('exit', () => {
      if (slot.activeRequest) {
        const request = slot.activeRequest;
        slot.activeRequest = undefined;
        request.reject(new Error('History parse worker exited unexpectedly'));
      }
    });

    child.on('error', (error) => {
      if (slot.activeRequest) {
        const request = slot.activeRequest;
        slot.activeRequest = undefined;
        request.reject(error);
      }
    });

    return slot;
  }

  private dispatch(): void {
    if (this.disposed) {
      return;
    }

    for (const slot of this.workers) {
      if (slot.activeRequest || this.queue.length === 0) {
        continue;
      }

      const request = this.queue.shift();
      if (!request) {
        return;
      }

      slot.activeRequest = request;
      slot.process.send({
        id: request.id,
        entry: request.entry
      } satisfies ScanRequestMessage);
    }
  }
}
