import { setTimeout as delay } from 'node:timers/promises';

const REPOSITORIES_FRAGMENT = `fragment PublicRepositories on User {
  repositories(first: 100, after: $after, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
    pageInfo { hasNextPage endCursor }
    nodes { isPrivate isFork stargazerCount
      languages(first: 100, orderBy: {field: SIZE, direction: DESC}) {
        pageInfo { hasNextPage } edges { size node { name color } }
      }
    }
  }
}`;

export async function request(query, variables, token, fetcher = fetch, wait = delay) {
  const payload = JSON.stringify({ query, variables });
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher('https://api.github.com/graphql', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: payload,
      });
    } catch {
      if (attempt === 2) throw new Error('GitHub connection failed.');
      await wait(2000 * (attempt + 1));
      continue;
    }
    if (response.status >= 500 && attempt < 2) {
      await response.body?.cancel();
      await wait(2000 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub request failed (HTTP ${response.status}).`);
    }
    const body = await response.json();
    // Partial GraphQL responses are not complete statistics. Never publish them.
    if (body.errors?.length || !body.data?.user)
      throw new Error('GitHub returned incomplete profile data.');
    return body.data.user;
  }
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid GitHub count.');
  return value;
}

export function dateTimestamp(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Invalid contribution date.');
  }
  return timestamp;
}

export function aggregateRepositories(repositories) {
  const languages = new Map();
  let stars = 0;
  for (const repo of repositories) {
    if (repo.isPrivate || repo.isFork) continue;
    stars += count(repo.stargazerCount);
    if (repo.languages.pageInfo.hasNextPage)
      throw new Error('Repository language list is incomplete.');
    for (const { size, node } of repo.languages.edges) {
      const entry = languages.get(node.name) || {
        name: node.name,
        color: node.color || '#858585',
        size: 0,
      };
      entry.size += count(size);
      languages.set(node.name, entry);
    }
  }
  return {
    stars,
    languages: [...languages.values()].filter((language) => language.size > 0),
  };
}

export function calendarWindow(calendar, now, length) {
  const days = new Map();
  for (const week of calendar.weeks)
    for (const day of week.contributionDays) {
      dateTimestamp(day.date);
      if (days.has(day.date)) throw new Error('Duplicate contribution date.');
      days.set(day.date, count(day.contributionCount));
    }
  const end = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const today = end.toISOString().slice(0, 10);
  if (!days.has(today)) throw new Error('Contribution calendar is incomplete.');
  if (days.get(today) === 0) end.setUTCDate(end.getUTCDate() - 1);
  return Array.from({ length }, (_, i) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - length + 1 + i);
    const key = date.toISOString().slice(0, 10);
    if (!days.has(key)) throw new Error('Contribution calendar has missing days.');
    return { date: key, count: days.get(key) };
  });
}

export async function fetchProfile(config, token, { now = new Date(), api = request } = {}) {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const user = await api(
    `query Profile($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
    user(login: $login) {
      ...PublicRepositories
      name login followers { totalCount } pullRequests { totalCount } issues { totalCount }
      repositoriesContributedTo(privacy: PUBLIC, includeUserRepositories: false,
        contributionTypes: [COMMIT, ISSUE, PULL_REQUEST], first: 1) { totalCount }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions totalPullRequestReviewContributions
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      }
    }
  }
  ${REPOSITORIES_FRAGMENT}`,
    { login: config.username, from: from.toISOString(), to: now.toISOString(), after: null },
    token,
  );

  const repositories = [...user.repositories.nodes];
  const cursors = new Set();
  let pageInfo = user.repositories.pageInfo;
  while (pageInfo.hasNextPage) {
    const after = pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error('Repository pagination did not advance.');
    cursors.add(after);
    const page = await api(
      `query Repositories($login: String!, $after: String) {
        user(login: $login) { ...PublicRepositories }
      }
      ${REPOSITORIES_FRAGMENT}`,
      { login: config.username, after },
      token,
    );
    repositories.push(...page.repositories.nodes);
    pageInfo = page.repositories.pageInfo;
  }

  const totals = aggregateRepositories(repositories);
  return {
    name: user.name || user.login,
    stats: {
      stars: totals.stars,
      commits: count(user.contributionsCollection.totalCommitContributions),
      prs: count(user.pullRequests.totalCount),
      issues: count(user.issues.totalCount),
      contributed: count(user.repositoriesContributedTo.totalCount),
      reviews: count(user.contributionsCollection.totalPullRequestReviewContributions),
      followers: count(user.followers.totalCount),
    },
    languages: totals.languages,
    days: calendarWindow(user.contributionsCollection.contributionCalendar, now, config.graphDays),
  };
}
