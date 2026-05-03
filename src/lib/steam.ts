export interface SteamGameData {
  appId: string;
  name: string;
  description: string;
  tags: string[];
  genres: string[];
  developer: string;
  releaseDate: string;
  reviewScore: string | null;
}

interface SteamAppData {
  name: string;
  short_description: string;
  categories?: { description: string }[];
  genres?: { description: string }[];
  developers?: string[];
  release_date?: { date: string };
  metacritic?: { score: number } | null;
}

type SteamAppDetailsResponse = Record<string, { success: boolean; data: SteamAppData }>;

export async function fetchSteamPage(url: string): Promise<SteamGameData> {
  // Handles: store.steampowered.com/app/1234567/Game_Name/
  const match = url.match(/store\.steampowered\.com\/app\/(\d+)/);
  if (!match?.[1]) throw new Error(`Cannot extract Steam app ID from URL: ${url}`);
  const appId = match[1];

  // Steam store API — no key required for basic data
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`,
  );
  if (!res.ok) throw new Error(`Steam API error: ${res.status}`);

  const json = (await res.json()) as SteamAppDetailsResponse;
  const entry = json[appId];
  if (!entry?.success) throw new Error(`Steam returned no data for app ID ${appId}`);

  const d = entry.data;
  return {
    appId,
    name: d.name,
    description: d.short_description,
    tags: (d.categories ?? []).map((c) => c.description),
    genres: (d.genres ?? []).map((g) => g.description),
    developer: d.developers?.[0] ?? "Unknown",
    releaseDate: d.release_date?.date ?? "Unknown",
    reviewScore: d.metacritic?.score?.toString() ?? null,
  };
}
