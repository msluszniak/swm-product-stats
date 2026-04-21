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
