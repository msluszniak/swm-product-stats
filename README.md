# swm-product-stats

Weekly aggregator for SWM product metrics. Posts a summary to Slack and appends
a row to `data/history.csv` for trend tracking.

## Sources

- **GitHub stars** — `react-native-executorch`, `react-native-rag`, `private-mind`
- **npm weekly downloads** — core packages and RNE fetcher packages
- **HuggingFace** — all models under the `software-mansion` author
- **Dependents** — `network/dependents` scrape of `react-native-executorch`,
  total count plus top 5 non-SWM consumers by stars (sampled)
- **Private Mind app metrics** — manual entry in `data/private-mind.json`:
  per-platform (iOS / Android) downloads, number of opinions, average rating.
  Stars are auto-fetched as part of GitHub stars.

## Configuration

Edit `scripts/config.ts` to add/remove repos, packages, or change the HF author.

## Required secrets (repo settings → Secrets and variables → Actions)

- `SLACK_WEBHOOK_URL` — incoming webhook for the destination channel
- `GITHUB_TOKEN` — provided automatically by Actions; no setup needed

## Schedule

Runs Monday 06:00 UTC (08:00 CET). Trigger manually via the Actions tab
(`workflow_dispatch`).

## Manual update: Private Mind

Before the Monday run, update `data/private-mind.json`:

```json
{
  "updated_at": "2026-04-20",
  "ios":     { "downloads": 1234, "opinions": 45, "rating": 4.7 },
  "android": { "downloads": 5678, "opinions": 123, "rating": 4.5 }
}
```

Leave any field as `null` if unknown — charts will skip null data points.

Commit and push — the next scheduled run will pick it up.

## Local run

```sh
npm install
SLACK_WEBHOOK_URL=... npm run collect      # posts to Slack
npm run collect                             # dry run, prints to stdout
```
