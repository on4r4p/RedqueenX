import Parser from "rss-parser";

export interface RssItem {
  title: string;
  link: string;
}

export class RssClient {
  private readonly parser = new Parser();

  async fetch(feedUrl: string): Promise<RssItem[]> {
    const feed = await this.parser.parseURL(feedUrl);
    return (feed.items ?? [])
      .filter((item) => item.title && item.link)
      .map((item) => ({
        title: item.title as string,
        link: item.link as string
      }));
  }
}
