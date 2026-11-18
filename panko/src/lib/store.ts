/** Everything Panko keeps lives on this device (IndexedDB). */
import type Anthropic from '@anthropic-ai/sdk';
import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Dataset } from './data';

export type MessageParam = Anthropic.Beta.BetaMessageParam;

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: MessageParam[];
}

export interface Memory {
  id: string;
  note: string;
  createdAt: string;
}

export interface ReportChart {
  type: 'bar' | 'line';
  title?: string;
  labels: string[];
  values: number[];
  unit?: string;
}
export interface ReportSection {
  heading: string;
  text?: string;
  table?: { columns: string[]; rows: (string | number | null)[][] };
  chart?: ReportChart;
}
export interface Report {
  id: string;
  title: string;
  summary?: string;
  sections: ReportSection[];
  createdAt: string;
  conversationId?: string;
}

export type ModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export interface Settings {
  mode: 'server' | 'key';
  serverUrl: string;
  accessCode: string;
  apiKey: string;
  model: ModelId;
}

export const MODELS: { id: ModelId; label: string; note: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best answers (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster, cheaper' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Quickest, cheapest' },
];

const db = createStore('panko', 'kv');

export const defaultSettings = (): Settings => ({
  mode: import.meta.env.VITE_PANKO_SERVER ? 'server' : 'key',
  serverUrl: import.meta.env.VITE_PANKO_SERVER || '',
  accessCode: '',
  apiKey: '',
  model: 'claude-opus-5-5',
});

export async function loadSettings(): Promise<Settings> {
  return { ...defaultSettings(), ...((await get<Partial<Settings>>('settings', db)) ?? {}) };
}
export const saveSettings = (s: Settings) => set('settings', s, db);

async function list<T>(prefix: string): Promise<T[]> {
  const ks = (await keys(db)).filter((k) => String(k).startsWith(prefix));
  const items = await Promise.all(ks.map((k) => get<T>(k, db)));
  return items.filter((x): x is Awaited<T> => !!x) as T[];
}

export const listDatasets = () => list<Dataset>('ds:');
export const saveDataset = (d: Dataset) => set(`ds:${d.id}`, d, db);
export const deleteDataset = (id: string) => del(`ds:${id}`, db);

export async function listConversations(): Promise<Conversation[]> {
  return (await list<Conversation>('c:')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export const saveConversation = (c: Conversation) => set(`c:${c.id}`, c, db);
export const deleteConversation = (id: string) => del(`c:${id}`, db);

export async function listMemories(): Promise<Memory[]> {
  return (await get<Memory[]>('memories', db)) ?? [];
}
export const saveMemories = (m: Memory[]) => set('memories', m, db);

export async function listReports(): Promise<Report[]> {
  return (await list<Report>('r:')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const saveReport = (r: Report) => set(`r:${r.id}`, r, db);
export const deleteReport = (id: string) => del(`r:${id}`, db);

/** Plain text of a conversation (what was said, not tool plumbing). */
export function conversationText(c: Conversation): { role: 'user' | 'assistant'; text: string }[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const m of c.messages) {
    if (m.role === 'system' || !m.content) continue;
    if (typeof m.content === 'string') {
      out.push({ role: m.role, text: m.content });
      continue;
    }
    const text = m.content
      .map((b) => {
        if (b.type === 'text') return b.text;
        if (b.type === 'tool_use' && b.name === 'create_report') return `[Report: ${(b.input as { title?: string }).title ?? ''}]`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text) out.push({ role: m.role, text });
  }
  return out;
}

export const getFlag = async (k: string) => !!(await get<boolean>(`flag:${k}`, db));
export const setFlag = (k: string) => set(`flag:${k}`, true, db);
