import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {computeGraph} from '../dist/graph.js';

globalThis.fetch = async url => ({ok: true, json: async () => JSON.parse(await readFile(url, 'utf8'))});
const phoenix = {
  dataset: 'phoenix', mode: 'reaction', actions: Array.from({length: 20}, (_, i) => i + 1),
  timeDecay: true, denoise: false,
};

test('a Phoenix response exactly one half-life later survives the inclusive threshold', async () => {
  const graph = await computeGraph({...phoenix, source: 'USA', target: 'DEU', startYear: 1982,
    endYear: 1982, days: 4, halfLifeDays: 4, normalization: 'none', minWeight: 0.5});
  const edge = graph.edges.find(e => e.source === 1 && e.target === 34);
  assert.equal(edge.count, 1);
  assert.ok(Math.abs(edge.weight - 0.5) < 1e-15);
});

test('a 1,286-day reaction retains its full normalized share', async () => {
  for (const normalization of ['source', 'target']) {
    const graph = await computeGraph({...phoenix, source: 'SVN', target: 'ALB', startYear: 2003,
      endYear: 2006, days: 1300, halfLifeDays: 1, normalization, minWeight: 0.1});
    assert.deepEqual(graph.edges.map(({source, target, count, weight}) => [source, target, count, weight]),
      [[17, 36, 1, 1]]);
  }
});

test('ICEWS includes the Isle of Man and its original story references', async () => {
  const graph = await computeGraph({...phoenix, dataset: 'icews', source: 'IRL', target: 'IMN',
    mode: 'direct', startYear: 1999, endYear: 1999, normalization: 'none', minWeight: 0});
  assert.ok(graph.events >= 2);
  const evidence = [...await graph.articleMatches(graph.edges[0])];
  assert.equal(evidence.length, graph.edges[0].count);
  assert.ok(evidence[0].every(event => event.story[1]));
});
