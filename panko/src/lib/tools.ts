/** The tools Claude can call. They all run here, on the device, against local data. */
import type Anthropic from '@anthropic-ai/sdk';
import { describe, findDataset, runQuery, type Dataset, type Query } from './data';
import { conversationText, type Conversation, type Memory, type Report, type ReportSection } from './store';

type Tool = Anthropic.Beta.BetaTool;

const cell = { type: ['string', 'number', 'null'] };

export const TOOLS: Tool[] = [
  {
    name: 'list_datasets',
    description:
      'List the datasets the user has loaded. With a dataset name, also returns per-column detail: number ranges and totals, date ranges, and the distinct values of text columns (use these exact values in filters). Call this before querying a dataset you have not looked at in this conversation.',
    input_schema: {
      type: 'object',
      properties: { dataset: { type: 'string', description: 'Optional dataset name for full column detail.' } },
    },
  },
  {
    name: 'query_data',
    description:
      'Run a query over one loaded dataset: filter rows, group, aggregate, sort and limit. Use group_by + metrics for totals and rankings (e.g. best sellers = group_by product, sum units, sort desc). Without group_by/metrics it returns raw rows. Text matching is case-insensitive. Dates are yyyy-mm-dd strings and compare as text. Returns at most 500 rows.',
    input_schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'between'] },
              value: { anyOf: [cell, { type: 'array', items: cell }], description: 'Array for "in" and [low, high] for "between".' },
            },
            required: ['column', 'op', 'value'],
          },
        },
        group_by: { type: 'array', items: { type: 'string' } },
        metrics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fn: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'] },
              column: { type: 'string', description: 'Not needed for count.' },
              as: { type: 'string', description: 'Output column name, e.g. "units".' },
            },
            required: ['fn'],
          },
        },
        columns: { type: 'array', items: { type: 'string' }, description: 'Columns to return for raw rows.' },
        sort: {
          type: 'array',
          items: {
            type: 'object',
            properties: { by: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } },
            required: ['by'],
          },
        },
        limit: { type: 'integer', description: 'Default 50, max 500.' },
      },
      required: ['dataset'],
    },
  },
  {
    name: 'create_report',
    description:
      'Show the user a finished report as a formatted card they can save, print or download. Call it once, after you have queried all the numbers you need. Every number must come from query results. Keep tables to the rows that matter (normally 25 or fewer). Charts are single-series: one value per label.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string', description: 'Two or three sentences with the headline findings.' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              text: { type: 'string', description: 'Markdown commentary.' },
              table: {
                type: 'object',
                properties: {
                  columns: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array', items: { type: 'array', items: cell } },
                },
                required: ['columns', 'rows'],
              },
              chart: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['bar', 'line'], description: 'bar to compare items, line for change over time.' },
                  title: { type: 'string' },
                  labels: { type: 'array', items: { type: 'string' } },
                  values: { type: 'array', items: { type: 'number' } },
                  unit: { type: 'string', description: 'e.g. "units" or "£".' },
                },
                required: ['type', 'labels', 'values'],
              },
            },
            required: ['heading'],
          },
        },
      },
      required: ['title', 'sections'],
    },
  },
  {
    name: 'search_conversations',
    description:
      'Search the user\'s earlier conversations with Panko (not this one) by keywords. Use it whenever the user refers to something discussed before ("last time", "what did we say about…"). Returns matching conversations with dates and snippets; use get_conversation for the full text.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords. Empty string lists the most recent conversations.' },
        limit: { type: 'integer', description: 'Default 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_conversation',
    description: 'Read the full text of an earlier conversation by its id (from search_conversations).',
    input_schema: { type: 'object', properties: { conversation_id: { type: 'string' } }, required: ['conversation_id'] },
  },
  {
    name: 'remember',
    description:
      'Save a short note that Panko will know in every future conversation: a lasting preference or fact about the user or their business (e.g. "Reports should use revenue, not units"). Not for one-off details.',
    input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
  },
  {
    name: 'forget',
    description: 'Delete a saved note by id (ids are shown in the system prompt).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export interface ToolContext {
  datasets: Dataset[];
  conversations: Conversation[];
  currentConversationId: string;
  memories: Memory[];
  setMemories(m: Memory[]): Promise<void>;
  addReport(r: Report): Promise<void>;
}

/** Friendly one-liner for the chat while a tool runs or after it ran. */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'list_datasets':
      return input.dataset ? `Looked at ${input.dataset}` : 'Checked your data';
    case 'query_data':
      return `Queried ${input.dataset ?? 'data'}`;
    case 'search_conversations':
      return input.query ? `Searched past chats for “${input.query}”` : 'Looked through past chats';
    case 'get_conversation':
      return 'Read an earlier chat';
    case 'remember':
      return `Remembered: ${input.note}`;
    case 'forget':
      return 'Forgot a note';
    case 'create_report':
      return `Built report: ${input.title}`;
    default:
      return name;
  }
}

const MAX_RESULT = 40_000;

function need(input: Record<string, unknown>, key: string, type: 'string' | 'array' = 'string') {
  const v = input[key];
  if (type === 'array' ? !Array.isArray(v) : typeof v !== 'string') throw new Error(`"${key}" is required (${type}).`);
  return v;
}

function words(s: string) {
  return s
    .toLowerCase()
    .split(/[^a-z0-9£%]+/)
    .filter((w) => w.length > 2);
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  let result: unknown;
  switch (name) {
    case 'list_datasets': {
      if (!ctx.datasets.length) result = { datasets: [], note: 'No data loaded. Ask the user to add a CSV in the Data panel.' };
      else if (typeof input.dataset === 'string' && input.dataset) result = describe(findDataset(ctx.datasets, input.dataset), true);
      else result = { datasets: ctx.datasets.map((d) => describe(d)) };
      break;
    }
    case 'query_data':
      need(input, 'dataset');
      result = runQuery(ctx.datasets, input as unknown as Query);
      break;
    case 'create_report': {
      const title = need(input, 'title') as string;
      const sections = need(input, 'sections', 'array') as ReportSection[];
      const report: Report = {
        id: crypto.randomUUID(),
        title,
        summary: typeof input.summary === 'string' ? input.summary : undefined,
        sections,
        createdAt: new Date().toISOString(),
        conversationId: ctx.currentConversationId,
      };
      await ctx.addReport(report);
      result = { shown_to_user: true, saved: true, report_id: report.id };
      break;
    }
    case 'search_conversations': {
      const q = words(String(input.query ?? ''));
      const limit = Math.min(Number(input.limit) || 5, 20);
      const scored = ctx.conversations
        .filter((c) => c.id !== ctx.currentConversationId)
        .map((c) => {
          const turns = conversationText(c);
          const hits = turns.filter((t) => q.some((w) => t.text.toLowerCase().includes(w)));
          const score = q.length
            ? q.reduce((s, w) => s + (c.title.toLowerCase().includes(w) ? 3 : 0) + hits.filter((h) => h.text.toLowerCase().includes(w)).length, 0)
            : 1;
          const snippets = (q.length ? hits : turns).slice(0, 3).map((t) => `${t.role}: ${t.text.slice(0, 300)}`);
          return { conversation_id: c.id, title: c.title, date: c.updatedAt.slice(0, 10), score, snippets };
        })
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(({ score: _s, ...rest }) => rest);
      result = scored.length ? { matches: scored } : { matches: [], note: 'No earlier conversations matched.' };
      break;
    }
    case 'get_conversation': {
      const id = need(input, 'conversation_id');
      const c = ctx.conversations.find((x) => x.id === id);
      if (!c) throw new Error('No conversation with that id.');
      result = { title: c.title, date: c.updatedAt.slice(0, 10), transcript: conversationText(c) };
      break;
    }
    case 'remember': {
      const note = (need(input, 'note') as string).trim();
      const m: Memory = { id: crypto.randomUUID().slice(0, 8), note, createdAt: new Date().toISOString() };
      await ctx.setMemories([...ctx.memories, m]);
      result = { saved: true, id: m.id };
      break;
    }
    case 'forget': {
      const id = need(input, 'id');
      const left = ctx.memories.filter((m) => m.id !== id);
      if (left.length === ctx.memories.length) throw new Error('No note with that id.');
      await ctx.setMemories(left);
      result = { deleted: true };
      break;
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
  let json = JSON.stringify(result);
  if (json.length > MAX_RESULT) json = json.slice(0, MAX_RESULT) + '… [truncated: ask for fewer rows or aggregate]';
  return json;
}
