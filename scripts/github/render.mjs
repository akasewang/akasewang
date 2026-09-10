export const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char],
  );
const n = (value) => Number(value.toFixed(3));
const font = "'Segoe UI',Ubuntu,Arial,sans-serif";

function svg(width, height, title, description, config, content, fullHeight = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
<title id="title">${escapeXml(title)}</title><desc id="description">${escapeXml(description)}</desc>
<style>text{font-family:${font};fill:#${config.text}}.heading{font-size:18px;font-weight:600;fill:#${config.title}}</style>
<rect x="0.5" y="0.5" width="${width - 1}" height="${fullHeight ? height - 1 : n(height * 0.99)}" rx="${config.radius}" fill="#${config.background}" stroke="#${config.border}"/>
${content}
</svg>\n`;
}

function icon(kind, x, y, color) {
  const drawings = {
    stars: '<path d="m8 1 2.1 4.5 4.9.7-3.5 3.4.8 4.9L8 12.2l-4.3 2.3.8-4.9L1 6.2l4.9-.7Z"/>',
    commits: '<path d="M1 5a7 7 0 1 1-.2 5M1 1v4h4M8 4v4l3 1.3"/>',
    prs: '<circle cx="4" cy="3" r="1.6"/><circle cx="4" cy="13" r="1.6"/><circle cx="12" cy="13" r="1.6"/><path d="M4 4.6v6.8M12 11.4V6q0-3-3-3H8m2-2L8 3l2 2"/>',
    issues: '<circle cx="8" cy="8" r="7.2"/><path d="M8 4.3v4"/><circle cx="8" cy="11.5" r=".4"/>',
    contributed:
      '<path d="M3 11V3q0-2 2-2h8v12h-2M3 11q0-2 2-2h8M3 11q0 2 2 2M6 12v3l1.5-1 1.5 1v-3Z"/>',
  };
  return `<g transform="translate(${x} ${y})" fill="none" stroke="#${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${drawings[kind]}</g>`;
}

export function rank(stats) {
  const activity = [
    [stats.commits, 250, 2],
    [stats.prs, 50, 3],
    [stats.issues, 25, 1],
    [stats.reviews, 2, 1],
  ];
  const earned =
    activity.reduce(
      (sum, [value, scale, weight]) => sum + weight * (1 - 2 ** (-value / scale)),
      0,
    ) +
    (4 * stats.stars) / (stats.stars + 50) +
    stats.followers / (stats.followers + 10);
  const progress = Math.max(0, Math.min(1, earned / 12));
  const percentile = 100 * (1 - progress);
  const grades = [
    [1, 'S'],
    [12.5, 'A+'],
    [25, 'A'],
    [37.5, 'A-'],
    [50, 'B+'],
    [62.5, 'B'],
    [75, 'B-'],
    [87.5, 'C+'],
    [100, 'C'],
  ];
  return { progress, grade: grades.find(([limit]) => percentile <= limit)[1] };
}

const compact = (value) =>
  value < 1000
    ? String(value)
    : `${(value / (value < 1e6 ? 1000 : 1e6)).toFixed(1).replace(/\.0$/, '')}${value < 1e6 ? 'k' : 'm'}`;

export function renderStats(profile, config) {
  const rating = rank(profile.stats);
  const rows = [
    ['stars', 'Total Stars Earned:'],
    ['commits', 'Total Commits (last year):'],
    ['prs', 'Total PRs:'],
    ['issues', 'Total Issues:'],
    ['contributed', 'Contributed to (last year):'],
  ];
  const title = `${profile.name}'s GitHub Stats`;
  let content = `<text class="heading" x="25" y="35">${escapeXml(title)}</text>`;
  rows.forEach(([key, label], i) => {
    content += icon(key, 25, 55 + i * 25, config.accent);
    content += `<g font-size="14" font-weight="700"><text x="50" y="${67.5 + i * 25}">${label}</text><text x="244.01" y="${67.5 + i * 25}">${compact(profile.stats[key])}</text></g>`;
  });
  const cx = config.statsWidth - 80;
  const circumference = 80 * Math.PI;
  content += `<g fill="none" stroke="#${config.title}" stroke-width="6"><circle cx="${cx}" cy="110.5" r="40" opacity=".2"/><circle cx="${cx}" cy="110.5" r="40" opacity=".8" stroke-linecap="round" stroke-dasharray="${n(circumference * rating.progress)} ${n(circumference)}" transform="rotate(-90 ${cx} 110.5)"/></g>`;
  // Locally drawn account emblem; no external image or font is loaded.
  content += `<g transform="translate(${cx - 31} 79)" fill="#${config.text}"><path fill-rule="evenodd" d="M31 0a31 31 0 1 0 0 62 31 31 0 0 0 0-62ZM14 11l10 6q7-2 14 0l10-6 1 13q5 5 4 12-1 10-14 12 3 3 3 8H22v-8Q9 46 8 36q-1-7 5-12Z"/><path d="M25 46q-5 10-13 0l-3-1q4 12 16 9Z"/></g>`;
  return svg(
    config.statsWidth,
    195,
    `${title}, Rank: ${rating.grade}`,
    rows.map(([key, label]) => `${label} ${profile.stats[key]}`).join(', '),
    config,
    content,
  );
}

export function renderLanguages(profile, config) {
  const languages = [...profile.languages]
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, 'en'))
    .slice(0, config.languageCount);
  const total = languages.reduce((sum, language) => sum + language.size, 0);
  const rows = Math.ceil(languages.length / 2);
  const height = Math.max(115, 90 + rows * 25);
  const barWidth = config.languagesWidth - 50;
  let content = '<text class="heading" x="25" y="35">Most Used Languages</text>';
  content += `<defs><clipPath id="language-bar"><rect x="25" y="55" width="${barWidth}" height="8" rx="5"/></clipPath></defs><g clip-path="url(#language-bar)">`;
  let offset = 25;
  for (const language of languages) {
    const width = (language.size / total) * barWidth;
    content += `<rect x="${n(offset)}" y="55" width="${n(width + 0.2)}" height="8" fill="${escapeXml(language.color)}"/>`;
    offset += width;
  }
  content += '</g>';
  languages.forEach((language, i) => {
    const x = 25 + Math.floor(i / rows) * 150;
    const y = 80 + (i % rows) * 25;
    content += `<circle cx="${x + 5}" cy="${y + 6}" r="5" fill="${escapeXml(language.color)}"/><text x="${x + 15}" y="${y + 10}" font-size="11">${escapeXml(language.name)} ${((100 * language.size) / total).toFixed(2)}%</text>`;
  });
  if (!total) content += '<text x="25" y="90" font-size="12">No public language data</text>';
  return svg(
    config.languagesWidth,
    height,
    'Most Used Languages',
    languages.map((x) => x.name).join(', '),
    config,
    content,
  );
}

export function smoothPath(points) {
  let result = `M${n(points[0][0])},${n(points[0][1])}`;
  const slopes = points.slice(1).map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]));
  const tangent = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes.at(-1);
    return slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]);
  });
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1],
      [x1, y1] = points[i];
    const third = (x1 - x0) / 3;
    result += `C${n(x0 + third)},${n(y0 + third * tangent[i - 1])},${n(x1 - third)},${n(y1 - third * tangent[i])},${n(x1)},${n(y1)}`;
  }
  return result;
}

export function renderActivity(profile, config) {
  const { graphWidth: width, graphHeight: height } = config;
  const left = 90,
    right = width - 50,
    top = 80,
    bottom = height - 70;
  const max = Math.max(1, ...profile.days.map((day) => day.count));
  const magnitude = 10 ** Math.floor(Math.log10(max / 8));
  const step = Math.max(
    1,
    [1, 2, 5, 10].map((x) => x * magnitude).find((x) => x >= max / 8),
  );
  const ceiling = Math.ceil(max / step) * step;
  const points = profile.days.map((day, i) => [
    left + (i * (right - left)) / (profile.days.length - 1),
    bottom - (day.count / ceiling) * (bottom - top),
  ]);
  const line = smoothPath(points);
  let content = `<text x="${width / 2}" y="39" text-anchor="middle" font-size="20" font-weight="600" style="fill:#${config.title}">${escapeXml(profile.name)}'s Contribution Graph</text>`;
  content += `<g stroke="#${config.text}" stroke-opacity=".3" stroke-dasharray="2">`;
  for (const [x] of points) content += `<path d="M${n(x)} ${top}V${bottom}"/>`;
  for (let value = 0; value <= ceiling; value += step) {
    const y = bottom - (value / ceiling) * (bottom - top);
    content += `<path d="M${left} ${n(y)}H${right}"/>`;
  }
  content += `</g><path d="${line}L${right},${bottom}L${left},${bottom}Z" fill="#${config.border}" opacity=".1"/><path class="activity-line" d="${line}" fill="none" stroke="#${config.accent}" stroke-width="4"/>`;
  points.forEach(([x, y], i) => {
    content += `<circle cx="${n(x)}" cy="${n(y)}" r="5" fill="#${config.point}"><title>${profile.days[i].date}: ${profile.days[i].count} contributions</title></circle>`;
    content += `<text x="${n(x - 4.5)}" y="${bottom + 20}" font-size="12" font-weight="600">${Number(profile.days[i].date.slice(-2))}</text>`;
  });
  for (let value = 0; value <= ceiling; value += step)
    content += `<text x="80" y="${n(bottom - (value / ceiling) * (bottom - top) + 4.5)}" text-anchor="end" font-size="12" font-weight="600">${value}</text>`;
  content += `<g font-size="12" font-weight="600" text-anchor="middle"><text x="${(left + right) / 2}" y="${height - 23}">Days</text><text transform="translate(30 ${(top + bottom) / 2}) rotate(-90)">Contributions</text></g>`;
  return svg(
    width,
    height,
    `${profile.name}'s Contribution Graph`,
    profile.days.map((day) => `${day.date}: ${day.count}`).join(', '),
    config,
    content,
    true,
  );
}

export function renderCharts(profile, config) {
  return {
    'github-stats': renderStats(profile, config),
    'top-languages': renderLanguages(profile, config),
    'activity-graph': renderActivity(profile, config),
  };
}
