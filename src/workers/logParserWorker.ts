import { LogParser } from '../services/LogParser';
import type { LogSessionScanEntry } from '../services/LogParser';

const parser = new LogParser();

process.on('message', (message: { id: number; entry: LogSessionScanEntry }) => {
  try {
    const prompts = parser.scanEntry(message.entry);
    process.send?.({
      type: 'scan:result',
      id: message.id,
      prompts
    });
  } catch (error) {
    process.send?.({
      type: 'scan:error',
      id: message.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

process.on('disconnect', () => {
  process.exit(0);
});
