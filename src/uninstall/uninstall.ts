import { runUninstallCleanup } from './uninstallCleanup';

async function main(): Promise<void> {
  const result = await runUninstallCleanup();
  const message = result.skipped
    ? '[Prompter] uninstall cleanup skipped because the target path was not considered safe to remove.'
    : `[Prompter] removed data directory: ${result.removedDataDir}`;

  console.log(message);
}

void main().catch((error) => {
  console.error('[Prompter] uninstall cleanup failed', error);
  process.exitCode = 1;
});
