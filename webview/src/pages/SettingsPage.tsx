import { useEffect, useState } from 'react';
import type { PrompterSettings } from '../../../src/shared/models';
import { playBuiltinTone } from '../lib/audioUtils';
import { postMessage } from '../api/vscode';
import { getLocaleText } from '../i18n';

const logSourceOrder = ['claude-code', 'codex', 'roo-code'] as const;

type LogSourceKey = (typeof logSourceOrder)[number];

function formatLogSourceName(source: LogSourceKey): string {
  return source;
}

function getSafeLogSource(settings: PrompterSettings, source: LogSourceKey): PrompterSettings['logSources'][LogSourceKey] {
  return settings.logSources[source] ?? { enabled: false, path: '' };
}

export function SettingsPage({
  settings,
  onSettingsChange,
  onDataDirSwitch,
  onClearCache
}: {
  settings: PrompterSettings;
  onSettingsChange: (nextSettings: Partial<PrompterSettings>) => void;
  onDataDirSwitch: (request: { targetDir: string; migrate: boolean }) => void;
  onClearCache: () => void;
}) {
  const localeText = getLocaleText(settings.language);
  const [draftDataDir, setDraftDataDir] = useState(settings.dataDir);
  const [dataDirMode, setDataDirMode] = useState<'fresh' | 'migrate'>('fresh');

  useEffect(() => {
    setDraftDataDir(settings.dataDir);
  }, [settings.dataDir]);

  const updateLogSource = (source: LogSourceKey, updates: Partial<PrompterSettings['logSources'][LogSourceKey]>) => {
    onSettingsChange({
      logSources: {
        ...settings.logSources,
        [source]: {
          ...settings.logSources[source],
          ...updates
        }
      }
    });
  };

  return (
    <div className="settings-page">
      <div className="settings-grid">
        <section className="settings-section" aria-labelledby="settings-general-heading">
          <div className="panel-header">
            <div>
              <h2 id="settings-general-heading">{localeText.settings.generalHeading}</h2>
              <p className="workspace-subtitle">{localeText.settings.generalSubtitle}</p>
            </div>
          </div>
          <div className="settings-section-body">
            <label className="field">
              <span>{localeText.settings.language}</span>
              <select value={settings.language} onChange={(event) => onSettingsChange({ language: event.target.value as PrompterSettings['language'] })}>
                <option value="zh-CN">中文</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-notifications-heading">
          <div className="panel-header">
            <div>
              <h2 id="settings-notifications-heading">{localeText.settings.notificationsHeading}</h2>
              <p className="workspace-subtitle">{localeText.settings.notificationsSubtitle}</p>
            </div>
          </div>
          <div className="settings-section-body">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.notifyOnFinish}
                onChange={(event) => onSettingsChange({ notifyOnFinish: event.target.checked })}
              />
              <span>{localeText.settings.notifyOnFinish}</span>
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.notifyOnPause}
                onChange={(event) => onSettingsChange({ notifyOnPause: event.target.checked })}
              />
              <span>{localeText.settings.notifyOnPause}</span>
            </label>

            <label className="field">
              <span>{localeText.settings.completionTone}</span>
              <select
                value={settings.completionTone}
                onChange={(event) => {
                  const tone = event.target.value as PrompterSettings['completionTone'];
                  onSettingsChange({ completionTone: tone });
                  if (tone === 'soft-bell' || tone === 'chime' || tone === 'ding') {
                    playBuiltinTone(tone);
                  } else if (tone === 'custom' && settings.customTonePath) {
                    postMessage({ type: 'settings:previewCustomTone', payload: { filePath: settings.customTonePath } });
                  }
                }}
              >
                <option value="off">{localeText.settings.toneOff}</option>
                <option value="soft-bell">{localeText.settings.toneSoftBell}</option>
                <option value="chime">{localeText.settings.toneChime}</option>
                <option value="ding">{localeText.settings.toneDing}</option>
                <option value="custom">{localeText.settings.toneCustom}</option>
              </select>
            </label>

            {settings.completionTone === 'custom' ? (
              <label className="field">
                <span>{localeText.settings.customTonePath}</span>
                <input
                  type="text"
                  value={settings.customTonePath}
                  onChange={(event) => onSettingsChange({ customTonePath: event.target.value })}
                />
              </label>
            ) : null}
          </div>
        </section>

        <section className="settings-section settings-section-wide" aria-labelledby="settings-storage-heading">
          <div className="panel-header">
            <div>
              <h2 id="settings-storage-heading">{localeText.settings.storageHeading}</h2>
              <p className="workspace-subtitle">{localeText.settings.storageSubtitle}</p>
            </div>
          </div>
          <div className="settings-section-body">
            <label className="field">
              <span>{localeText.settings.dataDirectory}</span>
              <input type="text" value={draftDataDir} onChange={(event) => setDraftDataDir(event.target.value)} />
            </label>

            {draftDataDir !== settings.dataDir ? (
              <div className="settings-data-dir-actions">
                <fieldset className="settings-radio-group">
                  <legend>{localeText.settings.whenSwitchingDirectories}</legend>
                  <label className="settings-toggle settings-toggle-inline">
                    <input
                      type="radio"
                      name="data-dir-mode"
                      checked={dataDirMode === 'fresh'}
                      onChange={() => setDataDirMode('fresh')}
                    />
                    <span>{localeText.settings.startWithEmptyDirectory}</span>
                  </label>
                  <label className="settings-toggle settings-toggle-inline">
                    <input
                      type="radio"
                      name="data-dir-mode"
                      checked={dataDirMode === 'migrate'}
                      onChange={() => setDataDirMode('migrate')}
                    />
                    <span>{localeText.settings.migrateExistingData}</span>
                  </label>
                </fieldset>
                <button
                  type="button"
                  onClick={() => onDataDirSwitch({ targetDir: draftDataDir, migrate: dataDirMode === 'migrate' })}
                >
                  {localeText.settings.applyDataDirectory}
                </button>
              </div>
            ) : null}

            <div className="settings-log-grid">
              {logSourceOrder.map((source) => {
                if (source === 'roo-code') {
                  return null;
                }

                const logSource = getSafeLogSource(settings, source);
                return (
                  <div key={source} className="settings-log-card">
                    <label className="settings-toggle settings-toggle-inline">
                      <input
                        type="checkbox"
                        checked={logSource.enabled}
                        onChange={(event) => updateLogSource(source, { enabled: event.target.checked })}
                      />
                      <span>{localeText.settings.enableLogs(formatLogSourceName(source))}</span>
                    </label>
                    <label className="field settings-log-field">
                      <span>{localeText.settings.logPath(formatLogSourceName(source))}</span>
                      <input
                        type="text"
                        value={logSource.path}
                        onChange={(event) => updateLogSource(source, { path: event.target.value })}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
