import Parser from "rss-parser";

export interface RssItem {
  title: string;
  link: string;
  publishedAt?: string | null;
}

export class RssClient {
  private readonly parser = new Parser();

  async fetch(feedUrl: string): Promise<RssItem[]> {
    const feed = await this.parser.parseURL(feedUrl);
    return (feed.items ?? [])
      .filter((item) => item.title && item.link)
      .map((item) => ({
        title: item.title as string,
        link: item.link as string,
        publishedAt: normalizeRssDate(item.isoDate ?? item.pubDate)
      }));
  }
}

function normalizeRssDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
