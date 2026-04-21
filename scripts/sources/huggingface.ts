export type HFModel = {
  id: string;
  downloads?: number;
  downloadsAllTime?: number;
  likes?: number;
};

export type HFSummary = {
  count: number;
  totalMonthly: number;
  totalAllTime: number;
  top5: { id: string; downloads: number; downloadsAllTime: number }[];
};

export async function fetchHFModels(author: string): Promise<HFModel[]> {
  const params = new URLSearchParams({ author, limit: '1000' });
  params.append('expand[]', 'downloads');
  params.append('expand[]', 'downloadsAllTime');
  params.append('expand[]', 'likes');
  const res = await fetch(`https://huggingface.co/api/models?${params}`);
  if (!res.ok) {
    console.warn(`[hf] list → ${res.status}`);
    return [];
  }
  return (await res.json()) as HFModel[];
}

export function summarizeHF(models: HFModel[]): HFSummary {
  const totalMonthly = models.reduce((s, m) => s + (m.downloads ?? 0), 0);
  const totalAllTime = models.reduce((s, m) => s + (m.downloadsAllTime ?? 0), 0);
  const top5 = [...models]
    .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      downloads: m.downloads ?? 0,
      downloadsAllTime: m.downloadsAllTime ?? 0,
    }));
  return { count: models.length, totalMonthly, totalAllTime, top5 };
}
