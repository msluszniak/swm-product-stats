import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration } from 'chart.js';
import type { DailyPoint } from './sources/npm.ts';
import type { StarEvent } from './sources/github.ts';

const WIDTH = 900;
const HEIGHT = 500;

const canvas = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: 'white',
});

const PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

type Row = Record<string, string>;

export function readHistory(historyPath: string): Row[] {
  if (!existsSync(historyPath)) return [];
  const lines = readFileSync(historyPath, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

function toNum(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

type YRange = { min?: number; max?: number; beginAtZero?: boolean };

async function renderLineChart(
  title: string,
  labels: string[],
  datasets: { label: string; data: (number | null)[] }[],
  outPath: string,
  yRange?: YRange
): Promise<void> {
  const config: ChartConfiguration<'line', (number | null)[], string> = {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length],
        fill: false,
        tension: 0.2,
        pointRadius: 3,
        spanGaps: true,
      })),
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: title, font: { size: 18 } },
        legend: { position: 'top' },
      },
      scales: {
        y: {
          beginAtZero: yRange?.beginAtZero ?? yRange?.min === undefined,
          min: yRange?.min,
          max: yRange?.max,
        },
      },
    },
  };
  const buf = await canvas.renderToBuffer(config);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
}

// ---------------------------------------------------------------------------
// Full-history charts, fetched live each run (independent of history.csv):
// npm daily downloads (same source as npm-stat.com) and cumulative GitHub
// stars. Both are bucketed into 7-day windows from `from` for a clean line.
// ---------------------------------------------------------------------------

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekBuckets(from: string, to: string): string[] {
  const buckets: string[] = [];
  let day = from;
  while (day <= to) {
    buckets.push(day);
    day = addDays(day, 7);
  }
  return buckets;
}

function bucketIndex(from: string, day: string): number {
  const ms = new Date(`${day}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.floor(ms / (7 * 86400 * 1000));
}

async function renderHistoryChart(
  title: string,
  labels: string[],
  datasets: { label: string; data: (number | null)[] }[],
  outPath: string
): Promise<void> {
  const config: ChartConfiguration<'line', (number | null)[], string> = {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length],
        fill: false,
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      })),
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: title, font: { size: 18 } },
        legend: { position: 'top' },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, autoSkip: true } },
        y: { beginAtZero: true },
      },
    },
  };
  const buf = await canvas.renderToBuffer(config);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
}

export async function generateLiveCharts(
  npmSeries: { label: string; points: DailyPoint[] }[],
  starSeries: { label: string; events: StarEvent[] }[],
  from: string,
  to: string,
  chartsDir: string
): Promise<string[]> {
  const labels = weekBuckets(from, to);
  const generated: string[] = [];

  // npm: sum daily downloads into each 7-day bucket → weekly downloads.
  const npmDatasets = npmSeries.map((s) => {
    const data: (number | null)[] = labels.map(() => null);
    for (const p of s.points) {
      if (p.day < from || p.day > to) continue;
      const i = bucketIndex(from, p.day);
      if (i < 0 || i >= data.length) continue;
      data[i] = (data[i] ?? 0) + p.downloads;
    }
    return { label: s.label, data };
  });
  if (npmDatasets.some((d) => d.data.some((v) => v != null))) {
    await renderHistoryChart(
      'npm downloads per week (full history)',
      labels,
      npmDatasets,
      join(chartsDir, 'npm-downloads.png')
    );
    generated.push('npm-downloads.png');
  }

  // stars: cumulative count as of the end of each 7-day bucket.
  const starDatasets = starSeries.map((s) => {
    const perBucket = labels.map(() => 0);
    for (const e of s.events) {
      if (e.starredAt < from) {
        perBucket[0] += 1; // stars earned before the window seed the baseline
        continue;
      }
      if (e.starredAt > to) continue;
      const i = bucketIndex(from, e.starredAt);
      if (i >= 0 && i < perBucket.length) perBucket[i] += 1;
    }
    let running = 0;
    const data = perBucket.map((n) => (running += n));
    return { label: s.label, data: data as (number | null)[] };
  });
  if (starDatasets.some((d) => d.data.some((v) => v != null && v > 0))) {
    await renderHistoryChart(
      'GitHub stars (cumulative)',
      labels,
      starDatasets,
      join(chartsDir, 'gh-stars.png')
    );
    generated.push('gh-stars.png');
  }

  return generated;
}

export async function generateCharts(
  historyPath: string,
  chartsDir: string
): Promise<string[]> {
  const rows = readHistory(historyPath);
  if (rows.length === 0) return [];

  const labels = rows.map((r) => r.date);
  const firstRow = rows[0];
  const generated: string[] = [];

  const renderIfData = async (
    datasets: { label: string; data: (number | null)[] }[],
    title: string,
    fileName: string,
    yRange?: YRange
  ) => {
    if (datasets.length === 0) return;
    if (datasets.every((ds) => ds.data.every((v) => v == null))) return;
    await renderLineChart(title, labels, datasets, join(chartsDir, fileName), yRange);
    generated.push(fileName);
  };

  const singleSeries = async (
    col: string,
    title: string,
    label: string,
    fileName: string
  ) => {
    if (!(col in firstRow)) return;
    await renderIfData(
      [{ label, data: rows.map((r) => toNum(r[col])) }],
      title,
      fileName
    );
  };

  const platformSeries = async (
    iosCol: string,
    androidCol: string,
    title: string,
    fileName: string,
    yRange?: YRange
  ) => {
    const datasets = [
      { label: 'iOS', data: rows.map((r) => toNum(r[iosCol])) },
      { label: 'Android', data: rows.map((r) => toNum(r[androidCol])) },
    ];
    await renderIfData(datasets, title, fileName, yRange);
  };

  // GitHub stars and npm downloads now come from generateLiveCharts (full
  // history fetched live), so they are intentionally not rendered from the CSV.
  await singleSeries(
    'hf_total_monthly',
    'HuggingFace — last 30-day downloads (all SWM models)',
    'HF last-30d downloads',
    'hf-monthly.png'
  );
  await singleSeries(
    'rne_dependents_total',
    'react-native-executorch — dependent repositories',
    'dependents',
    'rne-dependents.png'
  );
  await platformSeries(
    'pm_ios_downloads',
    'pm_android_downloads',
    'Private Mind — downloads (manual)',
    'pm-downloads.png'
  );
  await platformSeries(
    'pm_ios_opinions',
    'pm_android_opinions',
    'Private Mind — number of opinions (manual)',
    'pm-opinions.png'
  );
  await platformSeries(
    'pm_ios_rating',
    'pm_android_rating',
    'Private Mind — average rating (manual)',
    'pm-ratings.png',
    { min: 0, max: 5 }
  );

  return generated;
}
