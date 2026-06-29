import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEPENDENTS_MAX_PAGES,
  DEPENDENTS_REPO,
  DEPENDENTS_SHOW_N,
  DEPENDENTS_TOP_N,
  GITHUB_REPOS,
  HF_AUTHOR,
  HISTORY_FROM,
  NPM_PACKAGES,
  REPO_URL,
  SWM_ORGS,
} from './config.ts';
import { fetchStarHistory, fetchStars } from './sources/github.ts';
import { fetchNpmDailyRange, fetchNpmWeeklyDownloads } from './sources/npm.ts';
import { fetchHFModels, summarizeHF } from './sources/huggingface.ts';
import {
  type Dependent,
  type DependentsDiff,
  diffDependents,
  fetchDependents,
  topNonSWM,
} from './sources/dependents.ts';
import { generateCharts, generateLiveCharts } from './charts.ts';
import { postSlack } from './slack.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const dataDir = join(rootDir, 'data');
const chartsDir = join(rootDir, 'charts');
const historyPath = join(dataDir, 'history.csv');
const privateMindPath = join(dataDir, 'private-mind.json');
const dependentsPath = join(dataDir, 'dependents.json');

type PlatformStats = {
  downloads: number | null;
  opinions: number | null;
  rating: number | null;
};

type PrivateMind = {
  updated_at: string | null;
  ios: PlatformStats;
  android: PlatformStats;
};

const EMPTY_PLATFORM: PlatformStats = { downloads: null, opinions: null, rating: null };

type DependentsSnapshot = { date: string; top: Dependent[] };

type Row = {
  date: string;
  ghStars: Record<string, number | null>;
  npmWeekly: Record<string, number | null>;
  hf: ReturnType<typeof summarizeHF>;
  rneDependentsTotal: number;
  rneTop: Dependent[];
  privateMind: PrivateMind;
};

async function collect(): Promise<Row> {
  const date = new Date().toISOString().slice(0, 10);
  const githubToken = process.env.GITHUB_TOKEN;

  const [ghEntries, npmEntries, hfModels, dep] = await Promise.all([
    Promise.all(
      GITHUB_REPOS.map(
        async (r) => [`${r.owner}/${r.repo}`, await fetchStars(r.owner, r.repo, githubToken)] as const
      )
    ),
    Promise.all(
      NPM_PACKAGES.map(async (p) => [p, await fetchNpmWeeklyDownloads(p)] as const)
    ),
    fetchHFModels(HF_AUTHOR),
    fetchDependents(DEPENDENTS_REPO.owner, DEPENDENTS_REPO.repo, DEPENDENTS_MAX_PAGES),
  ]);

  const privateMind: PrivateMind = existsSync(privateMindPath)
    ? (JSON.parse(readFileSync(privateMindPath, 'utf8')) as PrivateMind)
    : { updated_at: null, ios: { ...EMPTY_PLATFORM }, android: { ...EMPTY_PLATFORM } };

  return {
    date,
    ghStars: Object.fromEntries(ghEntries),
    npmWeekly: Object.fromEntries(npmEntries),
    hf: summarizeHF(hfModels),
    rneDependentsTotal: dep.total,
    rneTop: topNonSWM(dep.sampled, SWM_ORGS, DEPENDENTS_TOP_N),
    privateMind,
  };
}

function readDependentsSnapshot(): DependentsSnapshot | null {
  if (!existsSync(dependentsPath)) return null;
  try {
    return JSON.parse(readFileSync(dependentsPath, 'utf8')) as DependentsSnapshot;
  } catch {
    return null;
  }
}

function writeDependentsSnapshot(snapshot: DependentsSnapshot): void {
  writeFileSync(dependentsPath, JSON.stringify(snapshot, null, 2) + '\n');
}

// Fetch the full-history series used only for the live charts (npm daily
// downloads + cumulative star events). Kept separate from the CSV row because
// it is heavier and not persisted.
async function fetchTimeseries(date: string, githubToken: string | undefined) {
  const [npmSeries, starSeries] = await Promise.all([
    Promise.all(
      NPM_PACKAGES.map(async (pkg) => ({
        label: pkg,
        points: await fetchNpmDailyRange(pkg, HISTORY_FROM, date),
      }))
    ),
    Promise.all(
      GITHUB_REPOS.map(async (r) => ({
        label: `${r.owner}/${r.repo}`,
        events: await fetchStarHistory(r.owner, r.repo, githubToken),
      }))
    ),
  ]);
  return { npmSeries, starSeries };
}

function csvHeader(row: Row): string[] {
  return [
    'date',
    ...Object.keys(row.ghStars).map((k) => `gh_stars:${k}`),
    ...Object.keys(row.npmWeekly).map((k) => `npm_weekly:${k}`),
    'hf_total_monthly',
    'hf_total_alltime',
    'hf_model_count',
    'rne_dependents_total',
    'pm_ios_downloads',
    'pm_android_downloads',
    'pm_ios_opinions',
    'pm_android_opinions',
    'pm_ios_rating',
    'pm_android_rating',
    'pm_updated_at',
  ];
}

function csvValues(row: Row): string[] {
  const blank = (v: number | null) => (v == null ? '' : String(v));
  return [
    row.date,
    ...Object.values(row.ghStars).map(blank),
    ...Object.values(row.npmWeekly).map(blank),
    String(row.hf.totalMonthly),
    String(row.hf.totalAllTime),
    String(row.hf.count),
    String(row.rneDependentsTotal),
    blank(row.privateMind.ios.downloads),
    blank(row.privateMind.android.downloads),
    blank(row.privateMind.ios.opinions),
    blank(row.privateMind.android.opinions),
    blank(row.privateMind.ios.rating),
    blank(row.privateMind.android.rating),
    row.privateMind.updated_at ?? '',
  ];
}

function appendHistory(row: Row): void {
  const header = csvHeader(row);
  const values = csvValues(row);
  const newLine = values.join(',');

  if (!existsSync(historyPath)) {
    writeFileSync(historyPath, header.join(',') + '\n' + newLine + '\n');
    return;
  }

  const lines = readFileSync(historyPath, 'utf8').trim().split('\n');
  const lastLine = lines[lines.length - 1] ?? '';
  const lastDate = lastLine.split(',')[0];
  const nextLines = lastDate === row.date ? [...lines.slice(0, -1), newLine] : [...lines, newLine];
  writeFileSync(historyPath, nextLines.join('\n') + '\n');
}

function readPreviousRow(): Record<string, string> | null {
  if (!existsSync(historyPath)) return null;
  const lines = readFileSync(historyPath, 'utf8').trim().split('\n');
  if (lines.length < 2) return null;
  const header = lines[0].split(',');
  const last = lines[lines.length - 1].split(',');
  return Object.fromEntries(header.map((h, i) => [h, last[i] ?? '']));
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function pctSuffix(d: number, base: number): string {
  if (base === 0) return '';
  const p = (d / base) * 100;
  return `, ${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function delta(curr: number | null, prev: string | undefined): string {
  if (curr == null) return '';
  if (prev == null || prev === '') return '';
  const p = Number(prev);
  if (Number.isNaN(p)) return '';
  const d = curr - p;
  if (d === 0) return ' (±0)';
  return ` (${d > 0 ? '+' : ''}${fmt(d)}${pctSuffix(d, p)})`;
}

// Inline delta for already-known numeric pairs (e.g. dependent star movement).
function deltaNum(d: number | null, base: number): string {
  if (d == null) return '';
  if (d === 0) return ' (±0)';
  return ` (${d > 0 ? '+' : ''}${fmt(d)}${pctSuffix(d, base - d)})`;
}

function formatSlack(
  row: Row,
  prev: Record<string, string> | null,
  depDiff: DependentsDiff,
  chartFiles: string[]
): string {
  const lines: string[] = [];
  lines.push(`:bar_chart: *SWM Product Stats — ${row.date}*`);

  lines.push('', '*GitHub stars*');
  for (const [repo, stars] of Object.entries(row.ghStars)) {
    const value = stars == null ? 'n/a' : fmt(stars);
    lines.push(`• \`${repo}\`: ${value}${delta(stars, prev?.[`gh_stars:${repo}`])}`);
  }

  lines.push('', '*npm downloads (last 7 days)*');
  for (const [pkg, dls] of Object.entries(row.npmWeekly)) {
    const value = dls == null ? 'n/a' : fmt(dls);
    lines.push(`• \`${pkg}\`: ${value}${delta(dls, prev?.[`npm_weekly:${pkg}`])}`);
  }

  lines.push('', `*HuggingFace* (${row.hf.count} \`${HF_AUTHOR}\` models)`);
  lines.push(
    `• Last 30 days: ${fmt(row.hf.totalMonthly)}${delta(row.hf.totalMonthly, prev?.['hf_total_monthly'])}`
  );
  lines.push(
    `• All-time: ${fmt(row.hf.totalAllTime)}${delta(row.hf.totalAllTime, prev?.['hf_total_alltime'])}`
  );
  if (row.hf.top5.length) {
    lines.push('• Top 5 (last 30d):');
    row.hf.top5.forEach((m, i) =>
      lines.push(`    ${i + 1}. \`${m.id}\` — ${fmt(m.downloads)}`)
    );
  }

  lines.push(
    '',
    `*react-native-executorch dependents*: ${fmt(row.rneDependentsTotal)}${delta(
      row.rneDependentsTotal,
      prev?.['rne_dependents_total']
    )}`
  );
  const link = (d: { owner: string; repo: string }) =>
    `<https://github.com/${d.owner}/${d.repo}|${d.owner}/${d.repo}>`;
  const shown = depDiff.ranked.slice(0, DEPENDENTS_SHOW_N);
  if (shown.length) {
    lines.push(`Top ${shown.length} non-SWM (by stars, sampled):`);
    shown.forEach((d, i) => {
      const change = d.isNew ? ' :new:' : deltaNum(d.starsDelta, d.stars);
      lines.push(`    ${i + 1}. ${link(d)} — ${fmt(d.stars)} ⭐${change}`);
    });
  }
  if (depDiff.dropped.length) {
    lines.push(`Dropped from top tracked: ${depDiff.dropped.map(link).join(', ')}`);
  }

  const pm = row.privateMind;
  const stamp = pm.updated_at ? `, updated ${pm.updated_at}` : '';
  const pmVal = (n: number | null) => (n == null ? 'n/a' : fmt(n));
  const pmRating = (n: number | null) => (n == null ? 'n/a' : n.toFixed(2));
  lines.push('', `*Private Mind* (manual${stamp})`);
  lines.push(
    `• Downloads — iOS: ${pmVal(pm.ios.downloads)}${delta(pm.ios.downloads, prev?.['pm_ios_downloads'])}, ` +
      `Android: ${pmVal(pm.android.downloads)}${delta(pm.android.downloads, prev?.['pm_android_downloads'])}`
  );
  lines.push(
    `• Opinions — iOS: ${pmVal(pm.ios.opinions)}${delta(pm.ios.opinions, prev?.['pm_ios_opinions'])}, ` +
      `Android: ${pmVal(pm.android.opinions)}${delta(pm.android.opinions, prev?.['pm_android_opinions'])}`
  );
  lines.push(
    `• Rating — iOS: ${pmRating(pm.ios.rating)}${delta(pm.ios.rating, prev?.['pm_ios_rating'])}, ` +
      `Android: ${pmRating(pm.android.rating)}${delta(pm.android.rating, prev?.['pm_android_rating'])}`
  );

  if (chartFiles.length) {
    lines.push('', '*Trend charts*');
    for (const file of chartFiles) {
      const label = file.replace(/\.png$/, '').replace(/-/g, ' ');
      const url = `${REPO_URL}/blob/main/charts/${file}`;
      lines.push(`• <${url}|${label}>`);
    }
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  const prev = readPreviousRow();
  const prevDeps = readDependentsSnapshot();
  const row = await collect();
  appendHistory(row);

  const depDiff = diffDependents(row.rneTop, prevDeps?.top ?? []);
  writeDependentsSnapshot({ date: row.date, top: row.rneTop });

  const { npmSeries, starSeries } = await fetchTimeseries(row.date, githubToken);
  const liveCharts = await generateLiveCharts(
    npmSeries,
    starSeries,
    HISTORY_FROM,
    row.date,
    chartsDir
  );
  const csvCharts = await generateCharts(historyPath, chartsDir);
  const chartFiles = [...liveCharts, ...csvCharts];
  console.log(`[charts] generated ${chartFiles.length} chart(s)`);

  const message = formatSlack(row, prev, depDiff, chartFiles);
  console.log(message);

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    await postSlack(webhook, message);
    console.log('[slack] posted');
  } else {
    console.warn('[slack] SLACK_WEBHOOK_URL not set, skipping post');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
