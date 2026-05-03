export interface YouTubeChannelShallow {
  channelId: string;
  name: string;
  url: string;
  description: string;
  subscribers: number | null;
}

export interface YouTubeChannelDetail extends YouTubeChannelShallow {
  recentVideos: { title: string; publishedAt: string; url: string }[];
  contactEmail: string | null;
  country: string | null;
  customUrl: string | null;
}

interface YouTubeSearchItem {
  id: { channelId?: string; videoId?: string };
  snippet: { title: string; description: string; publishedAt: string };
}

interface YouTubeSearchResponse {
  items: YouTubeSearchItem[];
}

interface YouTubeChannelItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    country?: string;
    customUrl?: string;
  };
  statistics: { subscriberCount?: string };
}

interface YouTubeChannelsResponse {
  items: YouTubeChannelItem[];
}

const YT_BASE = "https://www.googleapis.com/youtube/v3";

export async function searchYouTubeChannels(
  query: string,
  apiKey: string,
  maxResults = 10,
): Promise<YouTubeChannelShallow[]> {
  const searchRes = await fetch(
    `${YT_BASE}/search?` +
      new URLSearchParams({
        part: "snippet",
        q: query,
        type: "channel",
        maxResults: String(maxResults),
        key: apiKey,
      }),
  );
  if (!searchRes.ok) throw new Error(`YouTube search error: ${searchRes.status}`);

  const searchData = (await searchRes.json()) as YouTubeSearchResponse;
  const channelIds = searchData.items
    .map((i) => i.id.channelId)
    .filter((id): id is string => Boolean(id));

  if (channelIds.length === 0) return [];

  const statsRes = await fetch(
    `${YT_BASE}/channels?` +
      new URLSearchParams({
        part: "statistics,snippet",
        id: channelIds.join(","),
        key: apiKey,
      }),
  );
  if (!statsRes.ok) throw new Error(`YouTube channel stats error: ${statsRes.status}`);

  const statsData = (await statsRes.json()) as YouTubeChannelsResponse;

  return statsData.items.map((ch) => ({
    channelId: ch.id,
    name: ch.snippet.title,
    url: `https://www.youtube.com/channel/${ch.id}`,
    description: ch.snippet.description,
    subscribers: ch.statistics.subscriberCount
      ? parseInt(ch.statistics.subscriberCount, 10)
      : null,
  }));
}

export async function getYouTubeChannelDetail(
  channelUrl: string,
  apiKey: string,
): Promise<YouTubeChannelDetail> {
  const channelId = await resolveChannelId(channelUrl, apiKey);

  const [channelRes, videosRes] = await Promise.all([
    fetch(
      `${YT_BASE}/channels?` +
        new URLSearchParams({
          part: "snippet,statistics,brandingSettings",
          id: channelId,
          key: apiKey,
        }),
    ),
    fetch(
      `${YT_BASE}/search?` +
        new URLSearchParams({
          part: "snippet",
          channelId,
          order: "date",
          type: "video",
          maxResults: "10",
          key: apiKey,
        }),
    ),
  ]);

  if (!channelRes.ok) throw new Error(`YouTube channel detail error: ${channelRes.status}`);
  if (!videosRes.ok) throw new Error(`YouTube videos error: ${videosRes.status}`);

  const channelData = (await channelRes.json()) as YouTubeChannelsResponse;
  const videosData = (await videosRes.json()) as YouTubeSearchResponse;

  const ch = channelData.items[0];
  if (!ch) throw new Error(`Channel not found for URL: ${channelUrl}`);

  // Heuristic email extraction from description
  const emailMatch = ch.snippet.description.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  );

  return {
    channelId,
    name: ch.snippet.title,
    url: channelUrl,
    description: ch.snippet.description,
    subscribers: ch.statistics.subscriberCount
      ? parseInt(ch.statistics.subscriberCount, 10)
      : null,
    country: ch.snippet.country ?? null,
    customUrl: ch.snippet.customUrl ?? null,
    contactEmail: emailMatch?.[0] ?? null,
    recentVideos: videosData.items
      .filter((v) => v.id.videoId)
      .map((v) => ({
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
      })),
  };
}

async function resolveChannelId(url: string, apiKey: string): Promise<string> {
  // Direct channel ID
  const idMatch = url.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  if (idMatch?.[1]) return idMatch[1];

  // @handle
  const handleMatch = url.match(/youtube\.com\/@([\w.-]+)/);
  if (handleMatch?.[1]) {
    const res = await fetch(
      `${YT_BASE}/channels?` +
        new URLSearchParams({
          part: "id",
          forHandle: `@${handleMatch[1]}`,
          key: apiKey,
        }),
    );
    if (!res.ok) throw new Error(`YouTube handle resolve error: ${res.status}`);
    const data = (await res.json()) as YouTubeChannelsResponse;
    const id = data.items[0]?.id;
    if (!id) throw new Error(`Could not resolve YouTube channel from URL: ${url}`);
    return id;
  }

  // Legacy /c/name or /user/name — fall back to search
  const slugMatch = url.match(/youtube\.com\/(?:c|user)\/([\w.-]+)/);
  if (slugMatch?.[1]) {
    const res = await fetch(
      `${YT_BASE}/search?` +
        new URLSearchParams({
          part: "snippet",
          q: slugMatch[1],
          type: "channel",
          maxResults: "1",
          key: apiKey,
        }),
    );
    if (!res.ok) throw new Error(`YouTube channel search error: ${res.status}`);
    const data = (await res.json()) as YouTubeSearchResponse;
    const id = data.items[0]?.id.channelId;
    if (!id) throw new Error(`Could not resolve YouTube channel from URL: ${url}`);
    return id;
  }

  throw new Error(`Unrecognised YouTube URL format: ${url}`);
}
