/** One turn of the conversation: stream Claude's reply, run any tools it asks for, repeat. */
import Anthropic from '@anthropic-ai/sdk';
import type { Dataset } from './data';
import type { Memory, MessageParam, Settings } from './store';
import { runTool, TOOLS, toolLabel, type ToolContext } from './tools';

const SYSTEM = `You are Panko, a friendly, sharp assistant for a team in UK convenience retail and wholesale (sales reps, store managers, category managers).

What you do:
- Answer questions about the data the user has loaded (sales, stock, prices, stores, products) using your tools. Never invent or estimate numbers: every figure you state must come from a tool result. If the data cannot answer the question, say what is missing.
- Build reports when asked: query everything you need first, then call create_report once with the finished report. The card is shown to the user automatically, so afterwards reply with just one or two sentences.
- Remember things: when the user refers to an earlier chat, use search_conversations (and get_conversation if you need more). When they state a lasting preference or fact, save it with remember.

How you answer:
- British English, plain words, short. Lead with the answer, then the few numbers that back it up. Use a small markdown table when listing more than three items.
- "Best sellers" means ranking products by units sold over the whole period in the data, unless the user says otherwise or a saved note says otherwise. Say which measure and period you used in a few words. Offer revenue or a narrower period as a follow-up only when it would change the picture.
- If a question is ambiguous but a sensible default exists, use the default and say so rather than asking.
- Money is £ unless the data says otherwise. Round sensibly.`;

function contextBlock(datasets: Dataset[], memories: Memory[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const ds = datasets.length
    ? datasets.map((d) => `- ${d.name} (${d.rows.length} rows; columns: ${d.columns.map((c) => `${c.name}:${c.type}`).join(', ')})`).join('\n')
    : '- none loaded yet';
  const notes = memories.length ? memories.map((m) => `- [${m.id}] ${m.note}`).join('\n') : '- none';
  return `Today is ${today}.\n\nLoaded datasets:\n${ds}\n\nSaved notes about this user:\n${notes}`;
}

export function makeClient(s: Settings): Anthropic {
  if (s.mode === 'server') {
    if (!s.serverUrl) throw new Error('Add your Panko server address in Settings.');
    // The server holds the real API key and swaps it in; this placeholder never leaves for Anthropic.
    return new Anthropic({
      apiKey: 'panko-server',
      baseURL: s.serverUrl.replace(/\/+$/, ''),
      dangerouslyAllowBrowser: true,
      defaultHeaders: { 'x-panko-access': s.accessCode },
    });
  }
  if (!s.apiKey) throw new Error('Add an Anthropic API key in Settings (or a Panko server address).');
  return new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });
}

export interface TurnEvents {
  /** The visible assistant text so far for the reply currently streaming. */
  onText(text: string): void;
  /** A tool started running. */
  onTool(label: string): void;
  /** History changed (assistant message or tool results appended). */
  onMessages(messages: MessageParam[]): void;
}

export async function runTurn(
  settings: Settings,
  history: MessageParam[],
  ctx: ToolContext,
  events: TurnEvents,
  signal: AbortSignal,
): Promise<MessageParam[]> {
  const client = makeClient(settings);
  const messages = [...history];
  const fallbackOk = settings.model !== 'claude-haiku-5-5';

  for (let step = 0; step < 16; step++) {
    const stream = client.beta.messages.stream(
      {
        model: settings.model,
        max_tokens: 32000,
        system: [
          { type: 'text', text: SYSTEM },
          { type: 'text', text: contextBlock(ctx.datasets, ctx.memories) },
        ],
        tools: TOOLS,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        // If the model declines for policy reasons, the API retries on a fallback model in the same call.
        ...(fallbackOk ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      events.onText(text);
    });
    const msg = await stream.finalMessage();

    // Keep the full content (thinking blocks included) so the next request continues correctly.
    messages.push({ role: 'assistant', content: msg.content });
    events.onText('');
    events.onMessages([...messages]);

    // A declined or cut-off reply can't be continued as-is: swap it for a plain note.
    if (msg.stop_reason === 'refusal') {
      messages.pop();
      messages.push({ role: 'assistant', content: 'Sorry, I can’t help with that one.' });
      events.onMessages([...messages]);
      break;
    }
    if (msg.stop_reason === 'max_tokens') {
      messages.pop();
      messages.push({ role: 'assistant', content: '(My reply was cut short. Ask me to carry on, or for less detail.)' });
      events.onMessages([...messages]);
      break;
    }
    if (msg.stop_reason !== 'tool_use') break;

    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    // Run them in order (memory writes must not race), but return every result in one message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      events.onTool(toolLabel(call.name, input));
      try {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: await runTool(call.name, input, ctx) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: (e as Error).message, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
    events.onMessages([...messages]);
  }
  return messages;
}

/** Turn SDK errors into something a person can act on. */
export function explainError(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Access denied. Check the access code in Settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Wait a moment and try again.';
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the AI service. Check your connection and the server address in Settings.';
  if (e instanceof Anthropic.APIError) return `The AI service returned an error (${e.status ?? '?'}): ${e.message}`;
  return (e as Error)?.message || String(e);
}

/**
 * After a stop or error mid-turn, the history may end with tool calls that never got
 * results; the API needs a result for each, so close them off.
 */
export function repairHistory(messages: MessageParam[]): MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || typeof last.content === 'string') return messages;
  const open = last.content.filter((b) => b.type === 'tool_use') as Anthropic.Beta.BetaToolUseBlockParam[];
  if (!open.length) return messages;
  return [
    ...messages,
    { role: 'user', content: open.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: 'Stopped before this ran.', is_error: true })) },
  ];
}
