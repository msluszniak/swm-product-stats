import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration } from 'chart.js';

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

async function renderLineChart(
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
        y: { beginAtZero: true },
      },
    },
  };
  const buf = await canvas.renderToBuffer(config);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
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

  const seriesGroup = async (
    prefix: string,
    title: string,
    fileName: string,
    labelTransform: (col: string) => string = (c) => c.replace(prefix, '')
  ) => {
    const cols = Object.keys(firstRow).filter((k) => k.startsWith(prefix));
    if (cols.length === 0) return;
    const datasets = cols.map((col) => ({
      label: labelTransform(col),
      data: rows.map((r) => toNum(r[col])),
    }));
    await renderLineChart(title, labels, datasets, join(chartsDir, fileName));
    generated.push(fileName);
  };

  const singleSeries = async (
    col: string,
    title: string,
    label: string,
    fileName: string
  ) => {
    if (!(col in firstRow)) return;
    const data = rows.map((r) => toNum(r[col]));
    if (data.every((v) => v == null)) return;
    await renderLineChart(title, labels, [{ label, data }], join(chartsDir, fileName));
    generated.push(fileName);
  };

  await seriesGroup('gh_stars:', 'GitHub stars', 'gh-stars.png');
  await seriesGroup('npm_weekly:', 'npm downloads (last 7 days)', 'npm-weekly.png');
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
  await singleSeries(
    'pm_downloads',
    'Private Mind — downloads (manual)',
    'Private Mind downloads',
    'pm-downloads.png'
  );

  return generated;
}
