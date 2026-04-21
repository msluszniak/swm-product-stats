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
