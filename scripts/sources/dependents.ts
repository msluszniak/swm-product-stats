import * as cheerio from 'cheerio';

export type Dependent = { owner: string; repo: string; stars: number };

export async function fetchDependents(
  owner: string,
  repo: string,
  maxPages: number
): Promise<{ total: number; sampled: Dependent[] }> {
  const sampled: Dependent[] = [];
  let url: string | null = `https://github.com/${owner}/${repo}/network/dependents?dependent_type=REPOSITORY`;
  let total = 0;
  let pages = 0;

  while (url && pages < maxPages) {
    const res = await fetch(url, { headers: { 'User-Agent': 'swm-product-stats' } });
    if (!res.ok) {
      console.warn(`[dependents] ${url} → ${res.status}`);
      break;
    }
    const $ = cheerio.load(await res.text());

    if (pages === 0) {
      const header = $('#dependents a.btn-link.selected').text();
      const m = header.match(/([\d,]+)\s+Repositories/i);
      if (m) total = parseInt(m[1].replace(/,/g, ''), 10);
    }

    $('div.Box-row[data-test-id="dg-repo-pkg-dependent"]').each((_, el) => {
      const $el = $(el);
      const href = $el.find('a.text-bold').first().attr('href') ?? '';
      const parts = href.replace(/^\//, '').split('/');
      if (parts.length < 2) return;
      const [depOwner, depRepo] = parts;
      const starsText = $el.find('svg.octicon-star').parent().text().trim();
      const starsMatch = starsText.match(/([\d,]+)/);
      const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ''), 10) : 0;
      if (depOwner && depRepo) sampled.push({ owner: depOwner, repo: depRepo, stars });
    });

    const nextHref =
      $('#dependents .paginate-container a').filter((_, a) => $(a).text().trim() === 'Next').attr('href') ??
      $('.paginate-container a').filter((_, a) => $(a).text().trim() === 'Next').attr('href') ??
      null;
    url = nextHref ? (nextHref.startsWith('http') ? nextHref : `https://github.com${nextHref}`) : null;
    pages++;
  }

  return { total, sampled };
}

export function topNonSWM(sampled: Dependent[], swmOrgs: string[], n: number): Dependent[] {
  const seen = new Set<string>();
  const excluded = new Set(swmOrgs.map((o) => o.toLowerCase()));
  return [...sampled]
    .filter((d) => !excluded.has(d.owner.toLowerCase()))
    .filter((d) => {
      const key = `${d.owner}/${d.repo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.stars - a.stars)
    .slice(0, n);
}

export const depKey = (d: { owner: string; repo: string }) => `${d.owner}/${d.repo}`;

export type DependentChange = Dependent & {
  starsDelta: number | null; // null = newly entered the tracked set
  isNew: boolean;
};

export type DependentsDiff = {
  ranked: DependentChange[]; // current top, with per-repo star deltas
  dropped: Dependent[]; // were tracked last time, gone from the current set
};

// Compare the current top dependents against the previous snapshot to surface
// star movement, new entrants, and repos that fell out of the tracked set.
export function diffDependents(
  current: Dependent[],
  previous: Dependent[]
): DependentsDiff {
  const prevByKey = new Map(previous.map((d) => [depKey(d), d]));
  const currKeys = new Set(current.map(depKey));

  const ranked: DependentChange[] = current.map((d) => {
    const prev = prevByKey.get(depKey(d));
    return {
      ...d,
      starsDelta: prev ? d.stars - prev.stars : null,
      isNew: !prev,
    };
  });

  const dropped = previous.filter((d) => !currKeys.has(depKey(d)));
  return { ranked, dropped };
}
