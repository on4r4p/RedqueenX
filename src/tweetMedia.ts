import type { TweetMedia } from "./types";

export function mediaWithoutEmojiImages(media: TweetMedia[] | undefined): TweetMedia[] {
  return (media ?? []).filter((item) => !isEmojiMedia(item));
}

export function isEmojiMedia(media: Pick<TweetMedia, "url" | "previewImageUrl" | "videoUrl">): boolean {
  return [media.url, media.previewImageUrl, media.videoUrl].some((value) => Boolean(value && isEmojiMediaUrl(value)));
}

export function isEmojiMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    return (
      ((hostname === "abs.twimg.com" || hostname.endsWith(".twimg.com")) && /\/emoji\/v\d+\//.test(pathname)) ||
      hostname.includes("twemoji") ||
      pathname.includes("/twemoji/")
    );
  } catch {
    return false;
  }
}
