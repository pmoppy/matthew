import { readFileSync } from 'node:fs';
import { describe as group, expect, it } from 'vitest';
import { describe, parseCsv, parseFile, runQuery } from '../data';
import type { Conversation, Memory } from '../store';
import { runTool, type ToolContext } from '../tools';

const demo = parseFile(readFileSync(new URL('../../../public/demo/sales.csv', import.meta.url), 'utf8'), 'Demo sales.csv');

group('loading', () => {
  it('parses quoted CSV and semicolons', () => {
    expect(parseCsv('a;b\n"x;y";2\n')).toEqual([['a', 'b'], ['x;y', '2']]);
  });
  it('infers types and cleans headers', () => {
    const ds = parseFile('Product Name,Units Sold,Date\nCola,"1,200",03/08/2026\nCrisps,15,2026-08-10\n', 'my_file.csv');
    expect(ds.name).toBe('my file');
    expect(ds.columns).toEqual([
      { name: 'product_name', type: 'text' },
      { name: 'units_sold', type: 'number' },
      { name: 'date', type: 'date' },
    ]);
    expect(ds.rows[0]).toEqual({ product_name: 'Cola', units_sold: 1200, date: '2026-08-03' });
  });
  it('reads JSON arrays', () => {
    const ds = parseFile('[{"a":1,"b":"x"},{"a":2,"b":"y"}]', 'x.json');
    expect(ds.rows).toHaveLength(2);
    expect(ds.columns[0].type).toBe('number');
  });
  it('loads the demo data', () => {
    expect(demo.rows.length).toBe(4176);
    expect(describe(demo, true).columns.find((c) => c.name === 'store')).toMatchObject({ distinct_count: 4 });
  });
});

group('query', () => {
  it('ranks best sellers', () => {
    const r = runQuery([demo], {
      dataset: 'demo',
      group_by: ['product'],
      metrics: [{ fn: 'sum', column: 'units', as: 'units' }],
      sort: [{ by: 'units', dir: 'desc' }],
      limit: 3,
    });
    expect(r.rows).toHaveLength(3);
    expect(r.result_rows).toBe(87);
    expect(r.truncated).toBe(true);
    expect(Number(r.rows[0].units)).toBeGreaterThanOrEqual(Number(r.rows[1].units));
  });
  it('filters case-insensitively, with in/between', () => {
    const r = runQuery([demo], {
      dataset: 'Demo sales',
      filters: [
        { column: 'category', op: 'eq', value: 'energy' },
        { column: 'store', op: 'in', value: ['York Station', 'harrogate'] },
        { column: 'week_start', op: 'between', value: ['2026-09-01', '2026-09-30'] },
      ],
      group_by: ['store'],
      metrics: [{ fn: 'sum', column: 'revenue' }, { fn: 'count' }],
    });
    expect(r.rows.map((x) => x.store).sort()).toEqual(['Harrogate', 'York Station']);
    expect(r.rows[0].count).toBe(21 * 4); // 21 energy lines x 4 weeks in September
  });
  it('explains unknown columns and datasets', () => {
    expect(() => runQuery([demo], { dataset: 'demo', group_by: ['nope'] })).toThrow(/Unknown column.*Columns are/);
    expect(() => runQuery([demo], { dataset: 'stock' })).toThrow(/No dataset called "stock"/);
  });
});

group('tools', () => {
  const now = '2026-11-01T10:00:00Z';
  const old: Conversation = {
    id: 'c1',
    title: 'Energy drinks in Leeds',
    createdAt: now,
    updatedAt: now,
    messages: [
      { role: 'user', content: 'How is Red Bull doing in Leeds?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Red Bull 250ml is the top energy line in Leeds Central.' }] },
    ],
  };
  const make = (): ToolContext & { mem: Memory[] } => {
    const ctx = {
      datasets: [demo],
      conversations: [old],
      currentConversationId: 'c2',
      mem: [] as Memory[],
      get memories() {
        return ctx.mem;
      },
      async setMemories(m: Memory[]) {
        ctx.mem = m;
      },
      async addReport() {},
    };
    return ctx;
  };

  it('finds earlier conversations', async () => {
    const out = JSON.parse(await runTool('search_conversations', { query: 'red bull' }, make()));
    expect(out.matches[0]).toMatchObject({ conversation_id: 'c1', title: 'Energy drinks in Leeds' });
    const none = JSON.parse(await runTool('search_conversations', { query: 'crisps' }, make()));
    expect(none.matches).toEqual([]);
  });
  it('remembers and forgets', async () => {
    const ctx = make();
    const { id } = JSON.parse(await runTool('remember', { note: 'Use revenue for rankings' }, ctx));
    expect(ctx.mem.map((m) => m.note)).toEqual(['Use revenue for rankings']);
    await runTool('forget', { id }, ctx);
    expect(ctx.mem).toEqual([]);
  });
  it('lists datasets with column detail', async () => {
    const out = JSON.parse(await runTool('list_datasets', { dataset: 'demo' }, make()));
    expect(out.columns.find((c: { name: string }) => c.name === 'category').values).toContain('Energy');
  });
});
