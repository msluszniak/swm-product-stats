export async function fetchStars(
  owner: string,
  repo: string,
  token: string | undefined
): Promise<number | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'swm-product-stats',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!res.ok) {
    console.warn(`[github] ${owner}/${repo} → ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { stargazers_count: number };
  return data.stargazers_count;
}

export type StarEvent = { starredAt: string };

// Paginate the stargazers API with the star+json media type, which adds a
// `starred_at` timestamp to each entry, so we can reconstruct cumulative stars
// over time (the data behind star-history charts). 100 per page; a token is
// strongly recommended to avoid the 60 req/h unauthenticated limit.
export async function fetchStarHistory(
  owner: string,
  repo: string,
  token: string | undefined,
  maxPages = 200
): Promise<StarEvent[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.star+json',
    'User-Agent': 'swm-product-stats',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const events: StarEvent[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) {
      console.warn(`[github] stargazers ${owner}/${repo} p${page} → ${res.status}`);
      break;
    }
    const batch = (await res.json()) as { starred_at?: string }[];
    if (batch.length === 0) break;
    for (const s of batch) {
      if (s.starred_at) events.push({ starredAt: s.starred_at.slice(0, 10) });
    }
    if (batch.length < 100) break;
  }

  return events;
}
