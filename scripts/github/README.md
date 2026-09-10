These three charts are rendered by code in this directory using Node.js built-ins.
Generation has no npm dependencies, downloaded renderers, or chart-hosting services.
GitHub supplies the public data, runs the workflow, and serves the committed SVGs.

See [the architecture and maintenance guide](../../ARCHITECTURE.md) for setup,
flow diagrams, file responsibilities, metric definitions, and troubleshooting.

`Update GitHub charts` runs daily at 03:23 UTC (08:53 IST), can be run manually,
and runs when this directory or its workflow changes on `main`. Push the workflow
to the default branch to activate it. No manually configured secrets are needed:
the workflow uses the automatically supplied `GITHUB_TOKEN`. Repository rules
must permit its commits to the default branch.

`charts.json` holds colors and dimensions. The README displays both cards at 420px
and the graph at 100%. The stats SVG keeps the existing intrinsic width of 437px
so the long labels fit. The graph retains its 1200 by 420 coordinate space.

Commits and reviews cover the last year. PRs and issues are lifetime counts visible
to the workflow token. Contributed repositories uses GitHub's recent-contributions
count, excluding owned repositories. Stars and languages include all public owned
non-fork repositories, with pagination. The language chart shows the top eight,
with percentages normalized across those eight. An empty account is supported.
The graph shows 31 days, ending today when today has activity, otherwise yesterday.
The first API request includes the profile and the first 100 repositories; only
additional repository pages require more requests.

The rank ring is a local activity score, not an official GitHub ranking or a measured
population percentile. It combines commits, PRs, issues, reviews, stars, and followers;
the formula and grade thresholds are in `render.mjs`. Icons are locally drawn and
the line uses a monotone cubic curve. Small glyph and curve differences are possible.
SVGs show their complete content immediately, without entrance animations.

Connection failures and server errors get at most three attempts. Rate-limit and
partial API responses fail the refresh without publishing error images. All data
and SVGs are checked before writing, XML is checked before committing, and identical
data produces identical output without a commit. No timestamps are embedded.

Updates depend on GitHub availability; failed refreshes leave the saved images
visible. GitHub can delay schedules, cache images, or disable schedules after 60
days of repository inactivity. The initial images use the public snapshot captured
during migration; the first workflow run refreshes the data directly from GitHub.

For development, use Node.js 24 and run `npm ci --ignore-scripts` to install the
exact Prettier version in `package-lock.json`. Use `npm run format` to format,
`npm run format:check` to check formatting, and `npm test` to run the tests.
Tests can also run without installing anything: `node --test scripts/github/charts.test.mjs`.

`.prettierrc.json` defines two-space indentation, semicolons, single quotes,
trailing commas, arrow parentheses, object spacing, and a 100-column wrapping
target. It preserves Markdown wrapping and embedded template content.
`.editorconfig` keeps editor whitespace settings consistent; `.gitattributes`
preserves LF endings for code, configuration, and SVGs across operating systems.
Prettier formats code; behavioral correctness is checked by the tests.

The profile README, generated SVGs, and npm lockfile are excluded from formatting.
`Check code quality` checks formatting and tests on pull requests and relevant
pushes to `main`. Changes confined to generated SVGs or the profile README skip
that workflow. The daily chart workflow remains independent of npm and Prettier.
