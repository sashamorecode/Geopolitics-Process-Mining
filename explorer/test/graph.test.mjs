import assert from 'node:assert/strict';
import {test} from 'node:test';
import {computeGraph} from '../dist/graph.js';

const countries = [{code: 'AAA', name: 'A'}, {code: 'BBB', name: 'B'}, {code: 'CCC', name: 'C'}, {code: 'DDD', name: 'D'}];
const actions = [1, 2, 3].map(id => ({id, name: String(id)}));
const day = Date.UTC(2000, 0, 1) / 86400000;
const pack = (offset, action) => (day + offset) * 32 + action;
const fixture = {
  'catalog.json': {datasets: [{id: 'fixture', countries}], actions},
  'A.json': {AAABBB: [pack(-1, 3), pack(0, 1), pack(0, 2), pack(1, 2), pack(3, 3)]},
  'C.json': {CCCAAA: [pack(2, 1)], CCCDDD: [pack(2, 1)]},
  'B.json': {BBBCCC: [pack(0, 1), pack(1, 3)], BBBAAA: [pack(0, 2), pack(1, 3), pack(2, 1)]},
};
const sources = {stories: [], pairs: {}};
for (const name of ['A.json', 'B.json', 'C.json']) {
  for (const [pair, events] of Object.entries(fixture[name])) {
    sources.pairs[pair] = events.map((_, index) => sources.stories.push(pair + index) - 1);
  }
}
globalThis.fetch = async url => ({
  ok: true, json: async () => url.pathname.includes('/sources/') ? sources : fixture[url.pathname.split('/').at(-1)],
});
const base = {
  dataset: 'fixture', source: 'AAA', target: 'BBB', startYear: 2000, endYear: 2000,
  actions: [1, 2, 3], mode: 'direct', days: 1, normalization: 'none', denoise: false, minWeight: 0,
};
const weights = result => Object.fromEntries(result.edges.map(e => [[e.source, e.target], e.weight]));

test('inclusive year filters and action filtering precede directly-follows discovery', async () => {
  let graph = await computeGraph(base);
  assert.equal(graph.events, 4);
  assert.deepEqual(weights(graph), {'1,2': 1, '2,2': 1, '2,3': 1});
  graph = await computeGraph({...base, actions: [1, 3]});
  assert.deepEqual(weights(graph), {'1,3': 1});
  assert.deepEqual((await computeGraph({...base, actions: []})).nodes, []);
});

test('eventual windows preserve source order for ties and include the last day', async () => {
  assert.deepEqual(weights(await computeGraph({...base, mode: 'eventual'})), {'1,2': 2, '2,2': 1});
});

test('reactions use the reverse direction and exclude simultaneous events', async () => {
  const graph = await computeGraph({...base, mode: 'reaction'});
  assert.deepEqual(weights(graph), {'1,35': 1, '2,35': 1, '2,33': 1});
  assert.equal(graph.events, 7);
  assert.deepEqual(weights(await computeGraph({...base, mode: 'reaction', source: 'BBB', target: 'AAA'})),
                   {'2,34': 1, '1,35': 1});
});

test('normalization uses full totals before denoising and thresholding', async () => {
  assert.deepEqual(weights(await computeGraph({...base, normalization: 'source', denoise: true})),
                   {'1,2': 1, '2,3': 0.5});
  assert.deepEqual(weights(await computeGraph({...base, normalization: 'target', minWeight: 0.6})),
                   {'2,3': 1});
});

test('bilateral graphs retain separate country roles and count each stream once', async () => {
  const graph = await computeGraph({...base, mode: 'reaction', bothDirections: true});
  assert.equal(graph.events, 7);
  assert.deepEqual(weights(graph), {'1,35': 1, '2,35': 1, '2,33': 1, '34,2': 1, '33,3': 1});
  assert.equal(graph.nodes.find(n => n.id === 34).name, 'BBB → AAA · 2');
});

test('an open chain compares adjacent legs only, with strictly later dates', async () => {
  const config = {...base, mode: 'chain', nextCountries: ['CCC', 'DDD']};
  const graph = await computeGraph(config);
  assert.equal(graph.events, 7);
  assert.deepEqual(weights(graph), {'1,35': 1, '2,35': 1, '35,65': 1});
  assert.deepEqual(weights(await computeGraph({...config, actions: [1, 3]})), {'1,35': 1, '35,65': 1});
  await assert.rejects(computeGraph({...config, nextCountries: ['AAA']}), /different country/);
});

test('a closed chain adds the return stream and compares it with the first stream', async () => {
  const graph = await computeGraph({...base, mode: 'chain', nextCountries: ['CCC'], closeChain: true});
  assert.equal(graph.events, 7);
  assert.deepEqual(weights(graph), {'1,35': 1, '2,35': 1, '35,65': 1, '65,3': 1});
  assert.equal(graph.nodes.find(n => n.id === 65).to, 'AAA');
});

test('decay weights eligible pairs before normalization and preserves pair counts', async () => {
  const config = {...base, mode: 'eventual', days: 2, timeDecay: true};
  const day1 = 2 ** (-1 / 7), day2 = 2 ** (-2 / 7);
  const graph = await computeGraph(config);
  const score = weights(graph);
  assert.equal(graph.edges.find(e => e.source === 1 && e.target === 2).count, 2);
  assert.equal(score['1,2'], 1 + day1);
  assert.ok(Math.abs(score['2,3'] - day2) < 1e-12);
  assert.equal(score['1,3'], undefined);
  const normalized = weights(await computeGraph({...config, normalization: 'source', minWeight: 0.5}));
  assert.ok(Math.abs(normalized['2,2'] - day1 / (day1 + day2)) < 1e-12);
  assert.equal(normalized['2,3'], undefined);
  assert.deepEqual(weights(await computeGraph({...base, timeDecay: true})), weights(await computeGraph(base)));
});

test('bilateral and chain edges decay only across strictly later days', async () => {
  for (const config of [{mode: 'reaction', bothDirections: true},
                        {mode: 'chain', nextCountries: ['CCC'], closeChain: true}]) {
    const raw = await computeGraph({...base, ...config});
    const weighted = await computeGraph({...base, ...config, timeDecay: true});
    assert.equal(weighted.edges.length, raw.edges.length);
    for (const edge of weighted.edges) {
      assert.equal(weights(raw)[[edge.source, edge.target]], edge.count);
      assert.ok(Math.abs(edge.weight - edge.count * 2 ** (-1 / 7)) < 1e-12);
    }
  }
});

test('custom half-life changes the contribution of each eligible lag', async () => {
  const config = {...base, timeDecay: true, halfLifeDays: 0.5};
  assert.equal(weights(await computeGraph({...config, mode: 'eventual'}))['1,2'], 1.25);
  for (const mode of ['reaction', 'chain']) {
    const graph = await computeGraph({...config, mode, nextCountries: ['CCC']});
    assert.equal(weights(graph)['1,35'], 0.25);
  }
  for (const halfLifeDays of [0, -1, NaN, Infinity]) {
    await assert.rejects(computeGraph({...config, mode: 'eventual', halfLifeDays}), /Half-life/);
  }
});

test('story references follow the original event order through action and year filters', async () => {
  const graph = await computeGraph({...base, actions: [1, 3]});
  const [[first, following]] = [...await graph.articleMatches(graph.edges[0])];
  assert.equal(first.story, 'AAABBB1');
  assert.equal(following.story, 'AAABBB4');
});

test('every counted pair can be traced in each mode, including tied dates and closing legs', async () => {
  for (const mode of ['direct', 'eventual', 'reaction', 'chain']) {
    const graph = await computeGraph({...base, mode, days: 1, bothDirections: true,
      closeChain: true, nextCountries: ['CCC'], normalization: 'source', timeDecay: true});
    for (const edge of graph.edges) {
      const pairs = [...await graph.articleMatches(edge)];
      assert.equal(pairs.length, edge.count);
      for (const [source, following] of pairs) {
        const a = graph.nodes.find(n => n.id === edge.source);
        const b = graph.nodes.find(n => n.id === edge.target);
        assert.ok(source.story.startsWith(a.from + a.to));
        assert.ok(following.story.startsWith(b.from + b.to));
        if (mode === 'reaction' || mode === 'chain') assert.equal(following.day - source.day, 1);
      }
    }
  }
});
