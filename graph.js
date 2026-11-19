// Each record packs a UTC epoch day and a CAMEO root code (1–20).
const actionOf = record => record % 32;
const dayOf = record => Math.floor(record / 32);
const dayAtYearStart = year => Date.UTC(year, 0, 1) / 86400000;
const cache = new Map();

function readJson(path) {
  if (!cache.has(path)) {
    const request = fetch(new URL(path, import.meta.url)).then(response => {
      if (!response.ok) throw new Error(`Unable to load event data (HTTP ${response.status}).`);
      return response.json();
    }).catch(error => {
      cache.delete(path);
      throw error;
    });
    cache.set(path, request);
  }
  return cache.get(path);
}

export const loadCatalog = () => readJson('data/catalog.json');

async function readPair(dataset, source, target) {
  const shard = await readJson(`data/${dataset}/${source[0]}.json`);
  return shard[source + target] || [];
}

export const HALF_LIFE_DAYS = 7;
export const lagWeight = (days, halfLifeDays = HALF_LIFE_DAYS) => 2 ** (-days / halfLifeDays);

// Shift the sum's reference lag before converting to an ordinary floating-point weight.
function shiftWeight(sum, lag, halfLife) {
  const exponent = -lag / halfLife;
  return exponent < -1022 ? 2 ** (Math.log2(sum) + exponent) : sum * 2 ** exponent;
}

function atLeast(weight, threshold) {
  return weight >= threshold || threshold - weight <= 16 * Number.EPSILON * threshold;
}

function windowCounts(actions, following, isReaction, days, counts, scores, halfLifeDays) {
  // The active window contains only eligible predecessors of this event.
  const active = Array(21).fill(0);
  const weighted = scores && Array(21).fill(0);
  const newestDay = Array(21).fill(0);
  let first = 0;
  let next = 0;
  for (const [index, event] of following.entries()) {
    const day = dayOf(event);
    while (next < actions.length && (isReaction ? dayOf(actions[next]) < day : next < index)) {
      const record = actions[next++];
      const id = actionOf(record);
      if (weighted) {
        const nextDay = dayOf(record);
        weighted[id] = active[id] ? 1 + shiftWeight(weighted[id], nextDay - newestDay[id], halfLifeDays) : 1;
        newestDay[id] = nextDay;
      }
      active[id]++;
    }
    while (first < next && dayOf(actions[first]) < day - days) {
      const record = actions[first++];
      const id = actionOf(record);
      active[id]--;
      if (weighted) weighted[id] = active[id] ? weighted[id] - lagWeight(newestDay[id] - dayOf(record), halfLifeDays) : 0;
    }
    const target = actionOf(event);
    for (let id = 1; id <= 20; id++) {
      if (!active[id]) continue;
      counts[id][target] += active[id];
      if (weighted) {
        const lag = day - newestDay[id];
        const score = scores[id][target];
        if (!score) {
          scores[id][target] = {minLag: lag, sum: weighted[id]};
        } else {
          const minLag = Math.min(lag, score.minLag);
          score.sum = shiftWeight(score.sum, score.minLag - minLag, halfLifeDays) +
                      shiftWeight(weighted[id], lag - minLag, halfLifeDays);
          score.minLag = minLag;
        }
      }
    }
  }
}

function transitionEdges(first, second, mode, days, halfLifeDays) {
  const counts = Array.from({length: 21}, () => Array(21).fill(0));
  const scores = halfLifeDays !== null ? counts.map(row => [...row]) : null;
  if (mode === 'direct') {
    for (let i = 1; i < first.events.length; i++) {
      counts[actionOf(first.events[i - 1])][actionOf(first.events[i])]++;
    }
  } else {
    windowCounts(first.events, second.events, first !== second, days, counts, scores, halfLifeDays);
  }
  const edges = [];
  for (let a = 1; a <= 20; a++) {
    for (let b = 1; b <= 20; b++) {
      if (!counts[a][b]) continue;
      edges.push({
        source: first.offset + a, target: second.offset + b,
        count: counts[a][b], weight: counts[a][b], score: scores?.[a][b],
      });
    }
  }
  return edges;
}

// Enumerate only the selected edge, in following-event order, as the table is paged.
function* matchedEvents(first, second, sourceAction, targetAction, mode, days) {
  if (mode === 'direct') {
    for (let i = 1; i < first.events.length; i++) {
      if (actionOf(first.events[i - 1]) === sourceAction && actionOf(first.events[i]) === targetAction) {
        yield [i - 1, i];
      }
    }
    return;
  }
  const candidates = [];
  first.events.forEach((value, i) => { if (actionOf(value) === sourceAction) candidates.push(i); });
  let begin = 0, end = 0;
  for (const [j, value] of second.events.entries()) {
    if (actionOf(value) !== targetAction) continue;
    const day = dayOf(value);
    while (end < candidates.length && (first === second ? candidates[end] < j :
      dayOf(first.events[candidates[end]]) < day)) end++;
    while (begin < end && dayOf(first.events[candidates[begin]]) < day - days) begin++;
    for (let k = begin; k < end; k++) yield [candidates[k], j];
  }
}

async function articleMatches(dataset, legs, edge, mode, days) {
  const first = legs[Math.floor(edge.source / 32)], second = legs[Math.floor(edge.target / 32)];
  const sources = await Promise.all([first, second].map(leg => {
    const pair = leg.from + leg.to;
    const bucket = Array.from(pair).reduce((sum, char, i) => sum + (i + 1) * char.charCodeAt(0), 0) % 64;
    return readJson(`data/${dataset}/sources/${bucket}.json`);
  }));
  function article(leg, shard, index) {
    const ref = shard.pairs[leg.from + leg.to][leg.originalIndices[index]];
    return {day: dayOf(leg.events[index]), story: shard.stories[ref]};
  }
  return (function* () {
    for (const [i, j] of matchedEvents(first, second, edge.source % 32, edge.target % 32, mode, days)) {
      yield [article(first, sources[0], i), article(second, sources[1], j)];
    }
  })();
}

export async function computeGraph(config) {
  const {dataset, source, target, startYear, endYear, actions, mode, days,
         normalization, denoise, minWeight} = config;
  const {halfLifeDays = HALF_LIFE_DAYS} = config;
  const decay = config.timeDecay && mode !== 'direct';
  if (decay && (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0)) {
    throw new RangeError('Half-life must be a positive finite number of days.');
  }
  const activeHalfLife = decay ? halfLifeDays : null;
  const catalog = await loadCatalog();
  const info = catalog.datasets.find(item => item.id === dataset);
  const chain = mode === 'chain';
  const bilateral = mode === 'reaction';
  const countries = chain ? [source, target, ...(config.nextCountries || [])] : [source, target];
  if (chain && countries.length < 3) throw new Error('Choose at least three countries for a chain.');
  if (!info || !countries.every(code => info.countries.some(item => item.code === code))) {
    throw new Error('Choose countries from the selected dataset.');
  }
  if (new Set(countries).size !== countries.length) throw new Error('Choose a different country for each position.');
  if (startYear > endYear) throw new Error('Choose a valid year range.');
  const firstDay = dayAtYearStart(startYear);
  const limitDay = dayAtYearStart(endYear + 1);
  const allowed = new Set(actions);
  const eligible = record => dayOf(record) >= firstDay && dayOf(record) < limitDay && allowed.has(actionOf(record));

  // A closed chain adds the return leg and compares its events to the first leg.
  const route = [...countries];
  if (bilateral || (chain && config.closeChain)) route.push(source);
  const legs = await Promise.all(route.slice(0, -1).map(async (from, index) => {
    const to = route[index + 1];
    const originalIndices = [], events = [];
    (await readPair(dataset, from, to)).forEach((value, i) => {
      if (eligible(value)) {
        events.push(value);
        originalIndices.push(i);
      }
    });
    return {from, to, offset: index * 32, originalIndices, events};
  }));
  const nodes = [];
  for (const leg of legs) {
    const totals = Array(21).fill(0);
    for (const record of leg.events) totals[actionOf(record)]++;
    for (const action of catalog.actions) {
      if (!totals[action.id]) continue;
      const name = bilateral || chain ? `${leg.from} → ${leg.to} · ${action.name}` : action.name;
      nodes.push({id: leg.offset + action.id, action: action.id, from: leg.from, to: leg.to,
                  name, count: totals[action.id]});
    }
  }
  let edges = [];
  if (bilateral || chain) {
    const wrap = bilateral ? config.bothDirections : config.closeChain;
    const comparisons = legs.length - (wrap ? 0 : 1);
    for (let i = 0; i < comparisons; i++) {
      edges.push(...transitionEdges(legs[i], legs[(i + 1) % legs.length], mode, days, activeHalfLife));
    }
  } else {
    edges = transitionEdges(legs[0], legs[0], mode, days, activeHalfLife);
  }
  const normalized = normalization === 'source' || normalization === 'target';
  const minLags = new Map(), totals = new Map(), maxOut = new Map(), maxIn = new Map();
  if (decay && normalized) {
    for (const edge of edges) {
      const group = edge[normalization];
      minLags.set(group, Math.min(minLags.get(group) ?? Infinity, edge.score.minLag));
    }
  }
  for (const edge of edges) {
    const group = edge[normalization];
    if (decay) {
      const {minLag, sum} = edge.score;
      edge.weight = shiftWeight(sum, minLag - (minLags.get(group) ?? 0), halfLifeDays);
    }
    delete edge.score;
    if (normalized) totals.set(group, (totals.get(group) ?? 0) + edge.weight);
  }
  for (const edge of edges) {
    if (normalized) edge.weight /= totals.get(edge[normalization]);
    if (denoise && edge.source === edge.target) continue;
    maxOut.set(edge.source, Math.max(maxOut.get(edge.source) || 0, edge.weight));
    maxIn.set(edge.target, Math.max(maxIn.get(edge.target) || 0, edge.weight));
  }
  return {
    articleMatches: edge => articleMatches(dataset, legs, edge, mode, days),
    nodes, edges: edges.filter(e => atLeast(e.weight, minWeight) && (!denoise ||
      (e.source !== e.target && (atLeast(e.weight, maxOut.get(e.source)) || atLeast(e.weight, maxIn.get(e.target))))))
      .sort((a, b) => b.weight - a.weight || b.count - a.count),
    events: legs.reduce((sum, leg) => sum + leg.events.length, 0),
    sourceEvents: legs[0].events.length, targetEvents: legs[1]?.events.length || 0,
  };
}
