import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEPENDENTS_MAX_PAGES,
  DEPENDENTS_REPO,
  GITHUB_REPOS,
  HF_AUTHOR,
  NPM_PACKAGES,
  REPO_URL,
  SWM_ORGS,
} from './config.ts';
import { fetchStars } from './sources/github.ts';
import { fetchNpmWeeklyDownloads } from './sources/npm.ts';
import { fetchHFModels, summarizeHF } from './sources/huggingface.ts';
import { fetchDependents, topNonSWM } from './sources/dependents.ts';
import { generateCharts } from './charts.ts';
import { postSlack } from './slack.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const dataDir = join(rootDir, 'data');
const chartsDir = join(rootDir, 'charts');
const historyPath = join(dataDir, 'history.csv');
const privateMindPath = join(dataDir, 'private-mind.json');

type PrivateMind = {
  updated_at: string | null;
  downloads: number | null;
};

type Row = {
  date: string;
  ghStars: Record<string, number | null>;
  npmWeekly: Record<string, number | null>;
  hf: ReturnType<typeof summarizeHF>;
  rneDependentsTotal: number;
  rneTopNonSwm: { owner: string; repo: string; stars: number }[];
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
    : { updated_at: null, downloads: null };

  return {
    date,
    ghStars: Object.fromEntries(ghEntries),
    npmWeekly: Object.fromEntries(npmEntries),
    hf: summarizeHF(hfModels),
    rneDependentsTotal: dep.total,
    rneTopNonSwm: topNonSWM(dep.sampled, SWM_ORGS, 5),
    privateMind,
  };
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
    'pm_downloads',
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
    blank(row.privateMind.downloads),
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

function delta(curr: number | null, prev: string | undefined): string {
  if (curr == null) return '';
  if (prev == null || prev === '') return '';
  const p = Number(prev);
  if (Number.isNaN(p)) return '';
  const d = curr - p;
  if (d === 0) return ' (±0)';
  return d > 0 ? ` (+${fmt(d)})` : ` (${fmt(d)})`;
}

function formatSlack(
  row: Row,
  prev: Record<string, string> | null,
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
  if (row.rneTopNonSwm.length) {
    lines.push('Top 5 non-SWM (by stars, sampled):');
    row.rneTopNonSwm.forEach((d, i) =>
      lines.push(`    ${i + 1}. \`${d.owner}/${d.repo}\` — ${fmt(d.stars)} ⭐`)
    );
  }

  const pm = row.privateMind;
  const stamp = pm.updated_at ? `, updated ${pm.updated_at}` : '';
  lines.push('', `*Private Mind downloads* (manual${stamp})`);
  lines.push(`• ${pm.downloads ?? 'n/a'}${delta(pm.downloads, prev?.['pm_downloads'])}`);

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
  const prev = readPreviousRow();
  const row = await collect();
  appendHistory(row);
  const chartFiles = await generateCharts(historyPath, chartsDir);
  console.log(`[charts] generated ${chartFiles.length} chart(s)`);
  const message = formatSlack(row, prev, chartFiles);
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
