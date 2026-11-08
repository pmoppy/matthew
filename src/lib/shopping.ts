import { Capacitor } from '@capacitor/core';
import { createStore, get, set } from 'idb-keyval';
import { useCallback, useEffect, useState } from 'react';

const store = createStore('shelfscan-shopping', 'v1');
const KEY = 'list';

export interface ShoppingItem {
  id: string;
  name: string;
  category?: string;
  rank?: number;
  addedAt: number;
  done: boolean;
}

export interface ShoppingList {
  items: ShoppingItem[];
  has: (name: string) => boolean;
  add: (items: Omit<ShoppingItem, 'id' | 'addedAt' | 'done'>[]) => void;
  remove: (name: string) => void;
  toggle: (id: string) => void;
  clearDone: () => void;
  clearAll: () => void;
}

const key = (name: string) => name.trim().toLowerCase();

/** Device-local shopping list of missing top sellers, persisted in IndexedDB. */
export function useShoppingList(): ShoppingList {
  const [items, setItems] = useState<ShoppingItem[]>([]);

  useEffect(() => {
    get(KEY, store)
      .then((v) => setItems((v as ShoppingItem[] | undefined) ?? []))
      .catch(() => {});
  }, []);

  const update = useCallback((fn: (prev: ShoppingItem[]) => ShoppingItem[]) => {
    setItems((prev) => {
      const next = fn(prev);
      set(KEY, next, store).catch(() => {});
      return next;
    });
  }, []);

  return {
    items,
    has: (name) => items.some((i) => key(i.name) === key(name)),
    add: (adds) =>
      update((prev) => {
        const seen = new Set(prev.map((i) => key(i.name)));
        const fresh = adds
          .filter((a) => !seen.has(key(a.name)))
          .map((a, n) => ({ ...a, id: `${Date.now()}-${n}`, addedAt: Date.now(), done: false }));
        return [...prev, ...fresh];
      }),
    remove: (name) => update((prev) => prev.filter((i) => key(i.name) !== key(name))),
    toggle: (id) => update((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i))),
    clearDone: () => update((prev) => prev.filter((i) => !i.done)),
    clearAll: () => update(() => []),
  };
}

/** Every item is shared: still to get first, then ticked ones marked done. */
export function listAsText(items: ShoppingItem[]): string {
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const lines = ['ShelfScan – shopping list'];
  if (open.length) lines.push('', 'To get:', ...open.map((i) => `☐ ${i.name}`));
  if (done.length) lines.push('', 'Done:', ...done.map((i) => `✓ ${i.name}`));
  return lines.join('\n');
}

/** Share via the Android share sheet in the app, the Web Share API, or copy to the clipboard. */
export async function shareList(items: ShoppingItem[]): Promise<'shared' | 'copied' | 'failed'> {
  return shareText('Shopping list', listAsText(items));
}

export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, dialogTitle: `Share ${title.toLowerCase()}` });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'shared';
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
}
