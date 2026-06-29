export async function fetchNpmWeeklyDownloads(pkg: string): Promise<number | null> {
  const res = await fetch(
    `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`
  );
  if (!res.ok) {
    console.warn(`[npm] ${pkg} → ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { downloads?: number };
  return typeof data.downloads === 'number' ? data.downloads : null;
}

export type DailyPoint = { day: string; downloads: number };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Same data source as npm-stat.com: the registry "range" endpoint, which
// returns per-day download counts but caps each request at 18 months — so we
// walk the window in <=365-day chunks and concatenate.
export async function fetchNpmDailyRange(
  pkg: string,
  from: string,
  to: string
): Promise<DailyPoint[]> {
  const points: DailyPoint[] = [];
  let start = from;

  while (start <= to) {
    const chunkEnd = addDays(start, 364);
    const end = chunkEnd < to ? chunkEnd : to;
    const res = await fetch(
      `https://api.npmjs.org/downloads/range/${start}:${end}/${encodeURIComponent(pkg)}`
    );
    if (!res.ok) {
      console.warn(`[npm] range ${pkg} ${start}:${end} → ${res.status}`);
      break;
    }
    const data = (await res.json()) as { downloads?: DailyPoint[] };
    for (const p of data.downloads ?? []) {
      if (p.downloads > 0 || points.length > 0) points.push(p);
    }
    start = addDays(end, 1);
  }

  return points;
}
