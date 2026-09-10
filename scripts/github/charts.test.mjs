import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, stat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  aggregateRepositories,
  calendarWindow,
  dateTimestamp,
  fetchProfile,
  request,
} from './data.mjs';
import { renderCharts, smoothPath, rank } from './render.mjs';
import { generate, validateConfig, validateProfile, validateSvg } from './generate.mjs';

const config = JSON.parse(await readFile(new URL('./charts.json', import.meta.url), 'utf8'));
const dates = Array.from({ length: 33 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
  contributionCount: i % 5,
}));
const calendar = { weeks: [{ contributionDays: dates }] };
const apiProfile = {
  name: 'Example',
  followers: { totalCount: 4 },
  pullRequests: { totalCount: 3 },
  issues: { totalCount: 2 },
  repositoriesContributedTo: { totalCount: 1 },
  contributionsCollection: {
    totalCommitContributions: 7,
    totalPullRequestReviewContributions: 0,
    contributionCalendar: calendar,
  },
};
const profile = {
  name: 'Example & <Test>',
  stats: { stars: 3, commits: 127, prs: 13, issues: 0, contributed: 2, reviews: 1, followers: 4 },
  languages: Array.from({ length: 9 }, (_, i) => ({
    name: `Language ${i}`,
    color: '#38bdf8',
    size: 9 - i,
  })),
  days: dates.slice(-31).map((day) => ({ date: day.date, count: day.contributionCount })),
};
const repo = (stars, size, extra = {}) => ({
  isPrivate: false,
  isFork: false,
  stargazerCount: stars,
  languages: {
    pageInfo: { hasNextPage: false },
    edges: [{ size, node: { name: 'TypeScript', color: '#3178c6' } }],
  },
  ...extra,
});

test('configuration rejects invalid colors and dimensions that cannot render safely', () => {
  validateConfig(config);
  for (const change of [
    { username: 'invalid/account' },
    { background: 'url(example)' },
    { background: 123456 },
    { radius: -1 },
    { statsWidth: 100 },
    { graphDays: 1 },
    { graphDays: 31.5 },
    { graphHeight: Infinity },
    { languageCount: 0 },
    { languageCount: 9 },
  ]) {
    assert.throws(() => validateConfig({ ...config, ...change }));
  }
});

test('dates must exist in the calendar, including leap-year boundaries', () => {
  assert.equal(dateTimestamp('2024-02-29'), Date.UTC(2024, 1, 29));
  for (const value of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-1-01', null]) {
    assert.throws(() => dateTimestamp(value));
  }
  const invalid = structuredClone(profile);
  invalid.days[0].date = '2026-02-30';
  assert.throws(() => validateProfile(invalid, config));
});

test('public repository aggregation excludes forks/private data and merges byte counts', () => {
  const result = aggregateRepositories([
    repo(2, 40),
    repo(3, 60),
    repo(500, 500, { isPrivate: true }),
    repo(500, 500, { isFork: true }),
  ]);
  assert.equal(result.stars, 5);
  assert.equal(result.languages[0].size, 100);
  assert.throws(() =>
    aggregateRepositories([repo(1, 1, { languages: { pageInfo: { hasNextPage: true } } })]),
  );
});

test('all repository pages are counted, with token and UTC bounds passed to GitHub', async () => {
  const seen = [];
  const result = await fetchProfile(config, 'test-token', {
    now: new Date('2026-02-02T12:00:00Z'),
    api: async (query, variables, token) => {
      assert.equal(token, 'test-token');
      seen.push(variables.after);
      if (query.includes('query Profile')) {
        assert.equal(variables.from, '2025-02-02T12:00:00.000Z');
        return {
          ...apiProfile,
          repositories: {
            nodes: Array.from({ length: 100 }, () => repo(1, 1)),
            pageInfo: { hasNextPage: true, endCursor: 'page-two' },
          },
        };
      }
      return {
        repositories: {
          nodes: [repo(2, 2)],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    },
  });
  assert.deepEqual(seen, [null, 'page-two']);
  assert.equal(result.stats.stars, 102);
  assert.equal(result.languages[0].size, 102);
});

test('one request supplies all charts when repositories fit on the first page', async () => {
  let calls = 0;
  const result = await fetchProfile(config, 'test-token', {
    now: new Date('2026-02-02T12:00:00Z'),
    api: async () => {
      calls++;
      return {
        ...apiProfile,
        repositories: {
          nodes: [repo(3, 50)],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stats.stars, 3);
  assert.equal(result.languages[0].size, 50);
  assert.equal(result.days.length, 31);
});

test('repeated pagination cursors fail instead of looping or publishing duplicate totals', async () => {
  let calls = 0;
  await assert.rejects(
    fetchProfile(config, 'test-token', {
      now: new Date('2026-02-02T12:00:00Z'),
      api: async () => {
        calls++;
        return {
          ...apiProfile,
          repositories: {
            nodes: [repo(1, 1)],
            pageInfo: { hasNextPage: true, endCursor: 'same-cursor' },
          },
        };
      },
    }),
    /pagination did not advance/,
  );
  assert.equal(calls, 2);
});

test('calendar includes active today, excludes inactive today, and refuses missing days', () => {
  const now = new Date('2026-02-02T00:30:00Z');
  assert.equal(calendarWindow(calendar, now, 31).at(-1).date, '2026-02-02');
  const inactive = structuredClone(calendar);
  inactive.weeks[0].contributionDays.at(-1).contributionCount = 0;
  assert.equal(calendarWindow(inactive, now, 31).at(-1).date, '2026-02-01');
  inactive.weeks[0].contributionDays.splice(5, 1);
  assert.throws(() => calendarWindow(inactive, now, 31));
});

test('API retries transient errors, but rejects partial data and rate limits immediately', async () => {
  let calls = 0;
  let cancelled = false;
  const fetcher = async () => {
    calls++;
    if (calls === 1) throw new Error('Network failure with sensitive headers');
    if (calls === 2)
      return {
        ok: false,
        status: 503,
        body: {
          cancel: async () => {
            cancelled = true;
          },
        },
      };
    assert.equal(cancelled, true);
    return { ok: true, json: async () => ({ data: { user: { name: 'Example' } } }) };
  };
  assert.deepEqual(await request('', {}, 'test-token', fetcher, async () => {}), {
    name: 'Example',
  });
  assert.equal(calls, 3);
  await assert.rejects(
    request('', {}, 'test-token', async () => ({
      ok: true,
      json: async () => ({ data: { user: {} }, errors: [{ message: 'partial' }] }),
    })),
  );
  calls = 0;
  await assert.rejects(
    request('', {}, 'test-token', async () => {
      calls++;
      return { ok: false, status: 429 };
    }),
  );
  assert.equal(calls, 1);
});

test('API stops after three connection failures without exposing their contents', async () => {
  let calls = 0;
  await assert.rejects(
    request(
      '',
      {},
      'test-token',
      async () => {
        calls++;
        throw new Error('Authorization: test-token');
      },
      async () => {},
    ),
    { message: 'GitHub connection failed.' },
  );
  assert.equal(calls, 3);
});

test('SVGs retain dimensions, escape text, show eight languages and have no external resources', () => {
  validateProfile(profile, config);
  const charts = renderCharts(profile, config);
  Object.values(charts).forEach((svg) => validateSvg(svg));
  assert.match(charts['github-stats'], /width="437" height="195"/);
  assert.match(charts['top-languages'], /width="420" height="190"/);
  assert.match(charts['activity-graph'], /width="1200" height="420"/);
  assert.match(charts['github-stats'], /Example &amp; &lt;Test&gt;/);
  assert.doesNotMatch(charts['top-languages'], /Language 8/);
  assert.equal((charts['activity-graph'].match(/<circle /g) || []).length, 31);
  assert.throws(() =>
    validateSvg(charts['github-stats'].replace('</svg>', '<script>alert(1)</script></svg>')),
  );
  assert.throws(() => validateSvg(charts['github-stats'], 'Example'));
});

test('empty language list and flat activity render without invalid arithmetic', () => {
  const empty = structuredClone(profile);
  empty.languages = [];
  empty.days.forEach((day) => {
    day.count = 0;
  });
  Object.keys(empty.stats).forEach((key) => {
    empty.stats[key] = 0;
  });
  Object.values(renderCharts(empty, config)).forEach((svg) => validateSvg(svg));
  assert.equal(rank(empty.stats).grade, 'C');
  assert.equal(rank(empty.stats).progress, 0);
});

test('smooth line never overshoots contributions on alternating peaks', () => {
  const points = [
    [0, 0],
    [10, 100],
    [20, 0],
    [30, 50],
    [40, 50],
  ];
  const segments = smoothPath(points).split('C').slice(1);
  segments.forEach((segment, i) => {
    const [, y1, , y2, , y3] = segment.split(',').map(Number);
    const y0 = points[i][1];
    for (let t = 0; t <= 1; t += 0.05) {
      const value =
        (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3 * y3;
      assert(value >= Math.min(y0, y3) - 0.001 && value <= Math.max(y0, y3) + 0.001);
    }
  });
});

test('generation is deterministic, skips unchanged writes, and preserves images on bad data', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'profile-charts-test-'));
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), await realpath(tmpdir()));
    await rm(resolved, { recursive: true });
  });
  await mkdir(path.join(root, 'scripts/github'), { recursive: true });
  await copyFile(
    new URL('./charts.json', import.meta.url),
    path.join(root, 'scripts/github/charts.json'),
  );
  const args = { root, token: 'test-token', load: async () => profile };
  await generate(args);
  const files = ['github-stats', 'top-languages', 'activity-graph'].map((name) =>
    path.join(root, 'assets/github', `${name}.svg`),
  );
  const snapshot = async () =>
    Promise.all(
      files.map(async (file) => [await readFile(file, 'utf8'), (await stat(file)).mtimeMs]),
    );
  const before = await snapshot();
  await generate(args);
  assert.deepEqual(await snapshot(), before);
  const bad = structuredClone(profile);
  bad.languages[0].color = 'url(https://example.invalid/image)';
  await assert.rejects(generate({ ...args, load: async () => bad }));
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(
    generate({
      ...args,
      load: async () => {
        throw new Error('API unavailable');
      },
    }),
  );
  assert.deepEqual(await snapshot(), before);
});
