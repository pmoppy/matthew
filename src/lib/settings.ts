import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'shelfscan.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Build 9 briefly shipped 0.62 / 0.02; on an unseen shop that named too
      // many unknown flavours as look-alikes, so move those users back.
      if (saved.matchThreshold === 0.62 && saved.marginThreshold === 0.02) {
        saved.matchThreshold = DEFAULT_SETTINGS.matchThreshold;
        saved.marginThreshold = DEFAULT_SETTINGS.marginThreshold;
      }
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {
    /* private mode etc. */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const STATUS_STYLE: Record<string, { color: string; label: string; dash?: boolean }> = {
  top: { color: '#16a34a', label: 'Top seller' },
  delist: { color: '#dc2626', label: 'Consider delisting' },
  unsure: { color: '#f59e0b', label: 'Unsure, tap to check' },
  core: { color: '#3b82f6', label: 'Core range' },
  nodata: { color: '#64748b', label: 'Other product' },
  unknown: { color: '#e2e8f0', label: 'Not identified', dash: true },
  gap: { color: '#a855f7', label: 'Empty space', dash: true },
};
