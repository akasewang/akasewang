import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dateTimestamp, fetchProfile } from './data.mjs';
import { renderCharts } from './render.mjs';

export function validateConfig(config) {
  if (
    typeof config.username !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(config.username)
  ) {
    throw new Error('Invalid GitHub username.');
  }
  for (const key of ['background', 'title', 'text', 'accent', 'border', 'point']) {
    if (typeof config[key] !== 'string' || !/^[0-9a-f]{6}$/i.test(config[key]))
      throw new Error(`Invalid ${key} color.`);
  }
  const bounds = {
    radius: [0, 32],
    statsWidth: [437, 1600],
    languagesWidth: [350, 1600],
    languageCount: [1, 8],
    graphWidth: [300, 2400],
    graphHeight: [200, 800],
    graphDays: [2, 90],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(`Invalid ${key}; expected an integer between ${min} and ${max}.`);
    }
  }
}

export function validateProfile(profile, config) {
  if (!profile.name || typeof profile.name !== 'string') throw new Error('Missing display name.');
  for (const key of ['stars', 'commits', 'prs', 'issues', 'contributed', 'reviews', 'followers']) {
    if (!Number.isSafeInteger(profile.stats[key]) || profile.stats[key] < 0)
      throw new Error('Invalid statistic.');
  }
  for (const language of profile.languages) {
    if (
      typeof language.name !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(language.color) ||
      !Number.isFinite(language.size) ||
      language.size <= 0
    )
      throw new Error('Invalid language data.');
  }
  if (profile.days.length !== config.graphDays) throw new Error('Incomplete activity data.');
  let previousTimestamp;
  for (const day of profile.days) {
    const timestamp = dateTimestamp(day.date);
    if (
      !Number.isSafeInteger(day.count) ||
      day.count < 0 ||
      (previousTimestamp !== undefined && timestamp - previousTimestamp !== 86400000)
    )
      throw new Error('Invalid activity data.');
    previousTimestamp = timestamp;
  }
}

export function validateSvg(svg, token = '') {
  if (
    !svg.startsWith('<svg ') ||
    !svg.endsWith('</svg>\n') ||
    /\b(?:NaN|Infinity)\b/.test(svg) ||
    /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=|@import|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(
      svg,
    ) ||
    /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+)/.test(svg) ||
    (token && svg.includes(token))
  )
    throw new Error('Invalid SVG output.');
}

export async function generate({
  root = path.resolve(import.meta.dirname, '../..'),
  token = process.env.GITHUB_TOKEN,
  load = fetchProfile,
} = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is required.');
  const config = JSON.parse(await readFile(path.join(root, 'scripts/github/charts.json'), 'utf8'));
  validateConfig(config);
  const profile = await load(config, token);
  validateProfile(profile, config);
  const charts = renderCharts(profile, config);
  for (const svg of Object.values(charts)) validateSvg(svg, token);
  const output = path.join(root, 'assets/github');
  await mkdir(output, { recursive: true });
  for (const [name, svg] of Object.entries(charts)) {
    const file = path.join(output, `${name}.svg`);
    const previous = await readFile(file, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (previous !== svg) await writeFile(file, svg, 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  generate()
    .then(() => console.log('GitHub charts are up to date.'))
    .catch(() => {
      console.error(
        'Chart refresh failed. Existing published images are unchanged. Check GitHub API availability and workflow permissions.',
      );
      process.exitCode = 1;
    });
}
