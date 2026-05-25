const timeline = document.getElementById("timeline");
const timelineStatus = document.getElementById("timeline-status");
const timelinePaginations = Array.from(document.querySelectorAll("[data-timeline-pagination]"));
const rawTimelineLinks = Array.from(document.querySelectorAll("[data-raw-timeline-link]"));
const adminLinks = Array.from(document.querySelectorAll("[data-admin-link]"));
const sourceFilterInputs = Array.from(document.querySelectorAll("[data-source-filter]"));
const retryAbsTwimgFailures = document.getElementById("retry-abs-twimg-failures");
const archiveTimelineButton = document.getElementById("archive-timeline");
const viewArchiveTimelineButton = document.getElementById("view-archive-timeline");
const restoreArchiveTimelineButton = document.getElementById("restore-archive-timeline");
const timelineDefaultPageSize = 50;
const timelineMaxPageSize = 200;
const redditTimelineTextMaxCharacters = 700;
const timelineQueryLimit = readOptionalBoundedQueryInt("limit", 1, timelineMaxPageSize);
const defaultTimelineSources = ["tweet", "rss", "reddit"];
const timelineState = {
  offset: readBoundedQueryInt("offset", 0, 0, Number.MAX_SAFE_INTEGER),
  limit: timelineQueryLimit ?? timelineDefaultPageSize,
  customLimit: timelineQueryLimit !== null,
  sources: readSourceFilters(),
  archived: readArchivedMode(),
  total: 0,
  hasMore: false
};
let timelineAuthRole = "timeline";

function cookieValue(name) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function csrfHeaders(headers = {}) {
  const token = cookieValue("redqueen_csrf");
  return token ? { ...headers, "x-redqueenx-csrf": decodeURIComponent(token) } : headers;
}

function csrfFetch(url, options = {}) {
  return fetch(url, { ...options, headers: csrfHeaders(options.headers || {}) });
}

async function applyPublicConfig() {
  if (adminLinks.length === 0) return;
  try {
    const response = await fetch("/public-config");
    if (!response.ok) return;
    const config = await response.json();
    if (!config.adminUrl) return;
    adminLinks.forEach((link) => {
      link.href = config.adminUrl;
    });
  } catch {
    // Keep the local /admin link when public config cannot be loaded.
  }
}

async function applyTimelineAuth() {
  try {
    const response = await fetch("/timeline/auth");
    if (!response.ok) return;
    const data = await response.json();
    timelineAuthRole = data.user?.role === "admin" ? "admin" : "timeline";
  } catch {
    timelineAuthRole = "timeline";
  }
}

function avatarText(author) {
  if (!author) return "RQ";
  return author.slice(0, 2).toUpperCase();
}

function linkify(text) {
  const source = String(text ?? "");
  const urlPattern = /https?:\/\/\S+/g;
  let output = "";
  let lastIndex = 0;
  for (const match of source.matchAll(urlPattern)) {
    const url = match[0];
    const index = match.index ?? 0;
    output += linkifyMentionsAndHashtags(source.slice(lastIndex, index));
    output += `<span class="external-link-disabled" data-external-url="${escapeAttr(url)}" title="Click to open this URL.">${escapeHtml(url)}</span>`;
    lastIndex = index + url.length;
  }
  output += linkifyMentionsAndHashtags(source.slice(lastIndex));
  return output;
}

function linkifyMentionsAndHashtags(text) {
  return escapeHtml(text)
    .replace(/@([A-Za-z0-9_]+)/g, '<span class="mention">@$1</span>')
    .replace(/#([A-Za-z0-9_]+)/g, '<span class="hashtag">#$1</span>');
}

function displayTimelineText(item) {
  const text = String(item.text ?? "");
  if (item.source !== "reddit" || text.length <= redditTimelineTextMaxCharacters) {
    return text;
  }
  return `${text.slice(0, redditTimelineTextMaxCharacters - 3).trimEnd()}...`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function isXUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "x.com" ||
      hostname.endsWith(".x.com") ||
      hostname === "twitter.com" ||
      hostname.endsWith(".twitter.com") ||
      hostname === "t.co" ||
      hostname === "twimg.com" ||
      hostname.endsWith(".twimg.com")
    );
  } catch {
    return false;
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function renderAvatar(item, author) {
  if (item.avatarCache?.cachedUrl) {
    return `<img class="avatar avatar-img" src="${escapeAttr(item.avatarCache.cachedUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  }
  const hidden = item.avatarCache?.hasRemoteSource ? ' title="Remote avatar is not loaded directly. Use the media cache to fetch it through VPN."' : "";
  return `<div class="avatar${item.avatarCache?.hasRemoteSource ? " avatar-remote-hidden" : ""}"${hidden}>${avatarText(author)}</div>`;
}

function renderMedia(item) {
  const mediaItems = item.media ?? [];
  if (!mediaItems.length) return "";
  const html = mediaItems
    .map((media, index) => {
      const type = media.type === "video" ? "video" : "image";
      if (media.cachedUrl) {
        if (type === "video") {
          return `<video class="tweet-media-item" src="${escapeAttr(media.cachedUrl)}" controls preload="metadata" title="Double click for full screen"></video>`;
        }
        return `<img class="tweet-media-item" src="${escapeAttr(media.cachedUrl)}" alt="${escapeAttr(media.altText || "")}" loading="lazy" referrerpolicy="no-referrer" title="Double click for full screen" />`;
      }
      if (item.source === "reddit" && media.remoteUrl) {
        if (type === "video") {
          return `<video class="tweet-media-item" src="${escapeAttr(media.remoteUrl)}" controls preload="metadata" title="Double click for full screen"></video>`;
        }
        return `<img class="tweet-media-item" src="${escapeAttr(media.remoteUrl)}" alt="${escapeAttr(media.altText || "")}" loading="lazy" referrerpolicy="no-referrer" title="Double click for full screen" />`;
      }
      const status = media.cacheStatus || "missing";
      const label =
        status === "disabled"
          ? "Media cache disabled"
          : status === "expired"
            ? "Cached media expired"
            : status === "error"
              ? "Media download failed"
              : type === "video"
                ? "Remote video not cached"
                : "Remote image not cached";
      const canLoad = Boolean(item.mediaCache?.enabled && item.tweetId && media.hasRemoteSource);
      const placeholderContent = `<strong>${label}</strong>
        <span>${escapeHtml(media.lastError || media.altText || media.type || `media ${index + 1}`)}</span>`;
      if (canLoad) {
        return `<button type="button" class="tweet-media-placeholder tweet-media-placeholder-button" data-media-cache-reload="${escapeAttr(item.tweetId)}" title="Load this tweet media." aria-label="Load this tweet media.">
          ${placeholderContent}
        </button>`;
      }
      return `<div class="tweet-media-placeholder" title="Remote media is not loaded by the timeline to avoid direct IP exposure.">
        ${placeholderContent}
      </div>`;
    })
    .join("");
  return `<div class="tweet-media-grid">${html}</div>`;
}

function mediaReloadButtons(tweetId) {
  return Array.from(timeline.querySelectorAll("[data-media-cache-reload]")).filter((button) => button.dataset.mediaCacheReload === tweetId);
}

function setMediaReloadLoading(tweetId, loading) {
  mediaReloadButtons(tweetId).forEach((button) => {
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    if (!button.classList.contains("tweet-media-placeholder-button")) {
      button.textContent = loading ? "Loading medias..." : "Load medias";
    }
  });
}

function setTweetInlineStatus(sourceElement, message, tone = "info") {
  const body = sourceElement.closest(".tweet-body");
  if (!body) return;
  let status = body.querySelector("[data-tweet-inline-status]");
  if (!status) {
    status = document.createElement("p");
    status.dataset.tweetInlineStatus = "true";
    status.className = "tweet-inline-status";
    body.appendChild(status);
  }
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
  status.textContent = message;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForMediaCacheJob(jobId, tweetId, sourceElement) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(attempt === 0 ? 1200 : 2000);
    const response = await fetch(`/timeline/media-cache/jobs/${encodeURIComponent(jobId)}`);
    if (response.status === 401) {
      location.href = "/timeline/login";
      return false;
    }
    const result = await response.json().catch(() => ({ error: "Media job status failed" }));
    if (!response.ok) {
      throw new Error(result.error || "Media job status failed.");
    }
    const status = result.job?.status;
    if (status === "completed") {
      setTweetInlineStatus(sourceElement, "Media cache updated. Refreshing timeline...", "success");
      timelineStatus.textContent = "Media loaded through VPN cache.";
      return true;
    }
    if (status === "failed") {
      throw new Error(result.job?.lastError || "Media cache worker failed.");
    }
    setTweetInlineStatus(sourceElement, `Media job ${status || "pending"}...`, "info");
    timelineStatus.textContent = `Loading media for tweet ${tweetId} through Docker VPN worker...`;
  }
  setTweetInlineStatus(sourceElement, "Media job is still running. Refresh again in a moment.", "info");
  timelineStatus.textContent = "Media job is still running in the Docker VPN worker.";
  return false;
}

function renderTweetButtons(item, actionsEnabled) {
  if (!actionsEnabled) return "";
  if (!item.tweetId) return "";
  const liked = Boolean(item.likedAt);
  const retweeted = Boolean(item.retweetedAt);
  return `<div class="tweet-command-row">
    <button type="button" class="tweet-action-button" data-tweet-action="like" data-tweet-id="${escapeAttr(item.tweetId)}"${liked ? " disabled" : ""}>Favorite</button>
    <button type="button" class="tweet-action-button" data-tweet-action="retweet" data-tweet-id="${escapeAttr(item.tweetId)}"${retweeted ? " disabled" : ""}>Retweet</button>
  </div>`;
}

function luckFactorReason(reasons) {
  return (Array.isArray(reasons) ? reasons : []).find((reason) => String(reason).startsWith("luck_factor:")) || "";
}

function formatLuckFactorLabel(reason) {
  const value = String(reason || "").slice("luck_factor:".length).trim();
  return value ? `Luck factor ${escapeHtml(value)}` : "Luck factor";
}

function renderLuckFactorBadge(reasons) {
  const reason = luckFactorReason(reasons);
  if (!reason) return "";
  return `<span class="score-pill luck-factor-pill" title="This tweet was accepted by the random luck factor after normal scoring rejected it.">${formatLuckFactorLabel(reason)}</span>`;
}

function renderSourceBadge(item) {
  const source = String(item.source || "legacy");
  const labels = {
    tweet: "X",
    rss: "RSS",
    reddit: "Reddit"
  };
  const normalizedSource = source.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "legacy";
  const label = labels[source] || source;
  return `<span class="score-pill source-pill source-pill-${escapeAttr(normalizedSource)}">${escapeHtml(label)}</span>`;
}

function applyRawTimelineLinkState(enabled) {
  rawTimelineLinks.forEach((link) => {
    link.hidden = enabled === false;
  });
}

function timelineItemExternalId(item) {
  if (item.externalId) return String(item.externalId);
  const source = String(item.source || "");
  const id = String(item.id || "");
  const prefix = `${source}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : "";
}

function renderRedditTimelineItemButton(item) {
  if (item.source !== "reddit") return "";
  const externalId = timelineItemExternalId(item);
  if (!externalId) return "";
  const action = timelineState.archived ? "restore" : "archive";
  const label = timelineState.archived ? "Add Reddit" : "Ignore Reddit";
  const title = timelineState.archived
    ? "Restore this Reddit post to the active Timeline."
    : "Archive this Reddit post so it stays out of the active Timeline.";
  return `<button type="button" class="tweet-action-button tweet-list-button" data-timeline-item-action="${action}" data-timeline-item-source="reddit" data-timeline-item-id="${escapeAttr(externalId)}" title="${title}">${label}</button>`;
}

function renderListButtons(item) {
  const user = formatHandleForList(item.author);
  const banUser = user
    ? `<button type="button" class="tweet-action-button tweet-list-button" data-list-action="add" data-list-kind="banned_user" data-list-value="${escapeAttr(user)}" title="Add ${escapeAttr(user)} to banned users.">Ban user</button>`
    : "";
  const loadMedia = needsMediaReload(item)
    ? `<button type="button" class="tweet-action-button" data-media-cache-reload="${escapeAttr(item.tweetId)}">Load medias</button>`
    : "";
  return `<div class="tweet-command-row tweet-list-command-row">
    ${banUser}
    ${renderBanWordsPromptButton(false)}
    ${renderBannedWordExceptionPromptButton()}
    ${renderKeywordPromptButton()}
    ${loadMedia}
    ${renderRedditTimelineItemButton(item)}
  </div>`;
}

function renderBanWordsPromptButton(compact = false) {
  const title = compact
    ? "Add some word to ban."
    : "Add one word or phrase to banned words.";
  return `<button type="button" class="tweet-action-button tweet-list-button${compact ? " tweet-list-plus-button" : ""}" data-list-action="add" data-list-kind="banned_word" data-list-source="prompt" data-list-prompt-button="true"${compact ? ' data-list-add-more-word="true" aria-label="Add some word to ban"' : ""} title="${title}">${compact ? "+" : "Ban some words"}</button>`;
}

function renderBannedWordExceptionPromptButton() {
  return `<button type="button" class="tweet-action-button tweet-list-button" data-list-action="add" data-list-kind="banned_word_exception" data-list-source="prompt" data-list-prompt-button="true" title="Add an allowed phrase that contains a banned word.">Add exception</button>`;
}

function renderKeywordPromptButton() {
  const isAdmin = timelineAuthRole === "admin";
  const kind = isAdmin ? "keyword" : "suggested_keyword";
  const label = isAdmin ? "Add keyword" : "Suggest keyword";
  const title = isAdmin ? "Add a search keyword directly to Keywords." : "Suggest a search keyword for admin review.";
  return `<button type="button" class="tweet-action-button tweet-list-button" data-list-action="add" data-list-kind="${kind}" data-list-source="prompt" data-list-prompt-button="true" title="${title}">${label}</button>`;
}

function needsMediaReload(item) {
  if (!item.mediaCache?.enabled || !item.tweetId) return false;
  const mediaItems = item.media ?? [];
  return mediaItems.some((media) => media.hasRemoteSource && media.cacheStatus !== "cached");
}

function renderMetrics(item) {
  const retweets = item.retweetCount ?? 0;
  const favorites = item.favoriteCount ?? 0;
  const score = item.score ?? "legacy";
  const createdAt = item.tweetCreatedAt || item.acceptedAt;
  const engagementLabel = item.source === "reddit" ? "Reddit score" : "Retweets";
  const commentsLabel = item.source === "reddit" ? "Comments" : "Favorites";
  return `<div class="tweet-actions">
    ${item.keyword ? `<span>Keyword: ${escapeHtml(item.keyword)}</span>` : ""}
    <span>${engagementLabel}: ${retweets}</span><span>${commentsLabel}: ${favorites}</span>
    <span>Score: ${score}</span>
    ${createdAt ? `<span>${formatDate(createdAt)}</span>` : ""}
  </div>`;
}

async function refreshTimeline() {
  const params = new URLSearchParams({
    offset: String(timelineState.offset)
  });
  if (timelineState.customLimit) {
    params.set("limit", String(timelineState.limit));
  }
  if (timelineState.sources.length > 0 && timelineState.sources.length < defaultTimelineSources.length) {
    params.set("sources", timelineState.sources.join(","));
  }
  if (timelineState.archived) {
    params.set("archived", "1");
  }
  const response = await fetch(`/timeline/data?${params.toString()}`);
  if (response.status === 401) {
    location.href = "/timeline/login";
    return;
  }
  const data = await response.json();
  applyRawTimelineLinkState(data.rawTimelineEnabled);
  const items = Array.isArray(data.items) ? data.items : [];
  const pagination = data.pagination || { total: items.length, limit: timelineState.limit, offset: timelineState.offset, hasMore: false };
  if (!items.length && pagination.total > 0 && timelineState.offset > 0) {
    timelineState.offset = Math.max(0, Math.floor((pagination.total - 1) / timelineState.limit) * timelineState.limit);
    updateTimelineUrl();
    await refreshTimeline();
    return;
  }
  timelineState.total = pagination.total;
  timelineState.limit = pagination.limit;
  timelineState.offset = pagination.offset;
  timelineState.hasMore = pagination.hasMore;
  updateTimelineUrl();
  updateArchiveControls();
  renderPagination(pagination, items.length);
  timelineStatus.textContent = [
    timelineState.archived ? "Archive view." : "",
    pageSummary(pagination, items.length),
    "X avatars, X media, and external links are not loaded directly. Reddit-hosted media may display directly."
  ]
    .filter(Boolean)
    .join(" ");
  if (!items.length) {
    timeline.innerHTML = timelineState.archived
      ? '<div class="empty-state">No archived timeline item for the selected sources.</div>'
      : '<div class="empty-state">No imported data. Go to Admin, then run the legacy import.</div>';
    return;
  }

  timeline.innerHTML = items
    .map((item) => {
      const author = item.author || "legacy";
      const externalLabel = item.source === "rss" ? "RSS link hidden" : item.source === "reddit" ? "Reddit link hidden" : "Tweet link hidden";
      const tweetLink = item.tweetUrl
        ? `<span class="tweet-link external-link-disabled" data-external-url="${escapeAttr(item.tweetUrl)}" title="Click to show a warning before opening this link.">${externalLabel}</span>`
        : "";
      return `<article class="tweet-card">
        ${renderAvatar(item, author)}
        <div class="tweet-body">
          <div class="tweet-meta">
            <strong>${escapeHtml(author)}</strong>
            ${item.authorName ? `<span>${escapeHtml(item.authorName)}</span>` : ""}
            ${item.lineNumber ? `<span>Text.Sent line ${item.lineNumber}</span>` : ""}
            ${renderSourceBadge(item)}
            ${renderLuckFactorBadge(item.reasons)}
          </div>
          <p>${linkify(displayTimelineText(item))} ${tweetLink}</p>
          ${renderMedia(item)}
          ${renderMetrics(item)}
          ${renderListButtons(item)}
          ${renderTweetButtons(item, data.actionsEnabled)}
        </div>
      </article>`;
    })
    .join("");
}

applyPublicConfig().catch(() => undefined);
applyTimelineAuth()
  .catch(() => undefined)
  .finally(() => {
    refreshTimeline().catch((error) => {
      timelineStatus.textContent = error instanceof Error ? error.message : "Timeline failed to load.";
      timeline.innerHTML = '<div class="empty-state">Timeline failed to load.</div>';
    });
  });

function pageSummary(pagination, itemCount) {
  if (!pagination.total) return "";
  const start = pagination.offset + 1;
  const end = pagination.offset + itemCount;
  return `Showing ${start}-${end} of ${pagination.total}.`;
}

function renderPagination(pagination, itemCount) {
  const hasItems = pagination.total > 0;
  for (const paginationNav of timelinePaginations) {
    paginationNav.classList.toggle("is-hidden", !hasItems);
    if (!hasItems) continue;
    const label = paginationNav.querySelector("[data-pagination-label]");
    if (label) label.textContent = pageSummary(pagination, itemCount);
    const previous = paginationNav.querySelector('[data-page-action="prev"]');
    const next = paginationNav.querySelector('[data-page-action="next"]');
    const pageSize = paginationNav.querySelector("[data-page-size]");
    if (previous) previous.disabled = pagination.offset <= 0;
    if (next) next.disabled = !pagination.hasMore;
    if (pageSize) pageSize.value = String(pagination.limit);
  }
}

function readBoundedQueryInt(name, fallback, min, max) {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function readOptionalBoundedQueryInt(name, min, max) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(name)) return null;
  const value = Number(params.get(name));
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampTimelineLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return timelineState.limit;
  return Math.min(timelineMaxPageSize, Math.max(1, Math.floor(limit)));
}

function updateTimelineUrl() {
  const url = new URL(window.location.href);
  if (timelineState.customLimit) {
    url.searchParams.set("limit", String(timelineState.limit));
  } else {
    url.searchParams.delete("limit");
  }
  if (timelineState.offset > 0) {
    url.searchParams.set("offset", String(timelineState.offset));
  } else {
    url.searchParams.delete("offset");
  }
  if (timelineState.sources.length > 0 && timelineState.sources.length < defaultTimelineSources.length) {
    url.searchParams.set("sources", timelineState.sources.join(","));
  } else {
    url.searchParams.delete("sources");
  }
  if (timelineState.archived) {
    url.searchParams.set("archived", "1");
  } else {
    url.searchParams.delete("archived");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function readArchivedMode() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("archived");
  return value === "1" || value === "true";
}

function updateArchiveControls() {
  archiveTimelineButton?.classList.toggle("is-hidden", timelineState.archived);
  restoreArchiveTimelineButton?.classList.toggle("is-hidden", !timelineState.archived);
  if (viewArchiveTimelineButton) {
    viewArchiveTimelineButton.textContent = timelineState.archived ? "Back to timeline" : "View archive";
    viewArchiveTimelineButton.title = timelineState.archived ? "Show active timeline items." : "Show archived timeline items.";
  }
}

function readSourceFilters() {
  const params = new URLSearchParams(window.location.search);
  const sourceParam = params.get("sources");
  if (!sourceParam) return [...defaultTimelineSources];
  const values = sourceParam
    .split(",")
    .map((source) => source.trim())
    .filter((source) => defaultTimelineSources.includes(source));
  return values.length > 0 ? Array.from(new Set(values)) : [...defaultTimelineSources];
}

function syncSourceFilterInputs() {
  sourceFilterInputs.forEach((input) => {
    input.checked = timelineState.sources.includes(input.value);
  });
}

async function changeTimelineSources() {
  const selected = sourceFilterInputs.filter((input) => input.checked).map((input) => input.value);
  timelineState.sources = selected.length > 0 ? selected : [...defaultTimelineSources];
  timelineState.offset = 0;
  syncSourceFilterInputs();
  timelineStatus.textContent = "Loading timeline sources...";
  scrollTimelineToTop("auto");
  await refreshTimeline();
}

async function changeTimelinePage(action) {
  const previousOffset = timelineState.offset;
  if (action === "prev") {
    timelineState.offset = Math.max(0, timelineState.offset - timelineState.limit);
  } else if (action === "next") {
    timelineState.offset += timelineState.limit;
  } else {
    return;
  }
  if (timelineState.offset === previousOffset) {
    return;
  }
  timelineStatus.textContent = "Loading timeline page...";
  await refreshTimeline();
  scrollTimelineToTopAfterRender();
}

async function changeTimelinePageSize(value) {
  const nextLimit = clampTimelineLimit(value);
  if (nextLimit === timelineState.limit) {
    timelinePaginations.forEach((paginationNav) => {
      const pageSize = paginationNav.querySelector("[data-page-size]");
      if (pageSize) pageSize.value = String(timelineState.limit);
    });
    return;
  }
  timelineState.limit = nextLimit;
  timelineState.customLimit = true;
  timelineState.offset = 0;
  timelineStatus.textContent = "Loading timeline page...";
  scrollTimelineToTop("auto");
  await refreshTimeline();
  scrollTimelineToTopAfterRender();
}

function scrollTimelineToTop(behavior = "smooth") {
  window.scrollTo({ top: 0, behavior });
  if (behavior === "auto") {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}

function scrollTimelineToTopAfterRender() {
  requestAnimationFrame(() => {
    scrollTimelineToTop("smooth");
    window.setTimeout(() => {
      if (window.scrollY > 4) scrollTimelineToTop("auto");
    }, 120);
  });
}

function formatHandleForList(value) {
  const handle = String(value || "").trim();
  if (!handle) return "";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function selectedTextInside(button) {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return "";
  const card = button.closest(".tweet-card");
  const anchor = selection.anchorNode;
  if (card && anchor && !card.contains(anchor)) return "";
  return selection.toString().replace(/\s+/g, " ").trim().slice(0, 160);
}

function listActionText(kind, action) {
  const target = listTargetName(kind);
  if ((kind === "keyword" || kind === "suggested_keyword") && action === "add") return "Add keyword";
  if ((kind === "keyword" || kind === "suggested_keyword") && action === "delete") return "Remove keyword";
  if (kind === "banned_word_exception" && action === "add") return "Add exception";
  if (kind === "banned_word_exception" && action === "delete") return "Remove exception";
  if (action === "delete") return `Unban ${target}`;
  return `Ban ${target}`;
}

function listTargetName(kind) {
  if (kind === "banned_user") return "user";
  if (kind === "banned_word_exception") return "exception";
  if (kind === "keyword" || kind === "suggested_keyword") return "keyword";
  return "word";
}

function listCollectionLabel(kind) {
  if (kind === "banned_user") return "banned users";
  if (kind === "banned_word_exception") return "banned word exceptions";
  if (kind === "keyword") return "keywords";
  if (kind === "suggested_keyword") return "suggested keywords";
  return "banned words";
}

function listPendingFeedback(kind, action, wasReadd = false) {
  if (action === "delete") return "Removing...";
  if (kind === "keyword") return "Adding keyword...";
  if (kind === "suggested_keyword") return "Suggesting...";
  return wasReadd ? "Rebanning..." : "Banning...";
}

function listSuccessFeedback(kind, action, wasReadd = false, count = 1) {
  if (kind === "keyword") return action === "delete" ? "Keyword removed." : "Keyword added.";
  if (kind === "suggested_keyword") return action === "delete" ? "Suggestion removed." : "Keyword suggested.";
  if (kind === "banned_word_exception") return action === "delete" ? "Exception removed." : count > 1 ? `Added ${count} exceptions.` : "Exception added.";
  if (action === "delete") return "Unbanned.";
  return wasReadd ? "Rebanned." : count > 1 ? `Banned ${count}.` : "Banned.";
}

function shortListButtonValue(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 32 ? `${normalized.slice(0, 29)}...` : normalized;
}

function listButtonText(button, kind, action, value = "") {
  const target = listTargetName(kind);
  const displayValue = shortListButtonValue(value || button.dataset.listValue);
  if (action === "add" && kind === "banned_word" && !displayValue && button.dataset.listPromptButton === "true") return "Ban some words";
  if (kind === "keyword") {
    if (action === "delete") return displayValue ? `Remove keyword ${displayValue}` : "Remove keyword";
    return displayValue ? `Add keyword ${displayValue}` : "Add keyword";
  }
  if (kind === "suggested_keyword") {
    if (action === "delete") return displayValue ? `Remove suggestion ${displayValue}` : "Remove suggestion";
    return displayValue ? `Suggest ${displayValue}` : "Suggest keyword";
  }
  if (kind === "banned_word_exception") {
    if (action === "delete") return displayValue ? `Remove exception ${displayValue}` : "Remove exception";
    return displayValue ? `Allow ${displayValue}` : "Add exception";
  }
  if (action === "delete") return displayValue ? `Unban ${displayValue}` : `Unban ${target}`;
  if (button.dataset.listReadd === "true") return displayValue ? `Reban ${displayValue}` : `Reban ${target}`;
  return displayValue ? `Ban ${displayValue}` : `Ban ${target}`;
}

function parsePromptListValues(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized ? [normalized] : [];
}

function readListButtonValues(button) {
  if (!button.dataset.listValues) return [];
  try {
    const values = JSON.parse(button.dataset.listValues);
    return Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addMoreBanWordButtonAfter(button) {
  const sibling = button.nextElementSibling;
  return sibling?.matches?.('[data-list-add-more-word="true"]') ? sibling : null;
}

function listButtonFeedbackElement(button) {
  let feedback = button.nextElementSibling;
  if (feedback?.matches?.('[data-list-add-more-word="true"]')) {
    feedback = feedback.nextElementSibling;
  }
  return feedback?.dataset.listButtonFeedback === "true" ? feedback : null;
}

function setListButtonFeedback(button, message, tone = "info") {
  let feedback = listButtonFeedbackElement(button);
  if (!feedback || feedback.dataset.listButtonFeedback !== "true") {
    feedback = document.createElement("span");
    feedback.dataset.listButtonFeedback = "true";
    feedback.className = "tweet-list-feedback";
    (addMoreBanWordButtonAfter(button) || button).after(feedback);
  }
  feedback.classList.toggle("is-error", tone === "error");
  feedback.classList.toggle("is-success", tone === "success");
  feedback.textContent = message;
}

function setListButtonAction(button, kind, action, value, options = {}) {
  const normalizedValue = String(value || "").trim();
  button.dataset.listKind = kind;
  button.dataset.listAction = action;
  delete button.dataset.listAddMoreWord;
  if (action === "add" && options.readd) {
    button.dataset.listReadd = "true";
  } else {
    delete button.dataset.listReadd;
  }

  if (normalizedValue) {
    button.dataset.listValue = normalizedValue;
    delete button.dataset.listValues;
    delete button.dataset.listSource;
  } else if (kind === "banned_word" || kind === "banned_word_exception" || kind === "keyword" || kind === "suggested_keyword") {
    delete button.dataset.listValue;
    delete button.dataset.listValues;
    button.dataset.listSource = "prompt";
  }
  button.textContent = listButtonText(button, kind, action, normalizedValue);
  button.disabled = false;

  const label = listCollectionLabel(kind);
  if (action === "delete" && normalizedValue) {
    button.title = `Remove ${normalizedValue} from ${label}.`;
  } else if (action === "add" && normalizedValue && options.readd) {
    button.title = `Add ${normalizedValue} back to ${label}.`;
  } else if (action === "add" && normalizedValue) {
    button.title = `Add ${normalizedValue} to ${label}.`;
  } else {
    button.title =
      kind === "banned_word_exception"
        ? "Add one allowed phrase to banned word exceptions."
        : kind === "banned_word"
          ? "Add one word or phrase to banned words."
          : kind === "keyword"
            ? "Add a search keyword directly to Keywords."
            : kind === "suggested_keyword"
              ? "Suggest a search keyword for admin review."
          : `Add this user to ${label}.`;
  }
}

function setListButtonBatchDeleteAction(button, kind, values) {
  const normalizedValues = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  button.dataset.listKind = kind;
  button.dataset.listAction = "delete";
  button.dataset.listValues = JSON.stringify(normalizedValues);
  delete button.dataset.listValue;
  delete button.dataset.listSource;
  delete button.dataset.listReadd;
  delete button.dataset.listAddMoreWord;
  button.textContent =
    kind === "banned_word_exception"
      ? `Remove ${normalizedValues.length} exceptions`
      : kind === "keyword"
        ? `Remove ${normalizedValues.length} keywords`
        : kind === "suggested_keyword"
          ? `Remove ${normalizedValues.length} suggestions`
          : `Unban ${normalizedValues.length} ${kind === "banned_user" ? "users" : "words"}`;
  button.title = `Remove ${normalizedValues.join(", ")} from ${listCollectionLabel(kind)}.`;
  button.disabled = false;
}

function ensureAdditionalBanWordButton(button) {
  if (button.dataset.listKind !== "banned_word") return;
  const commandRow = button.closest(".tweet-list-command-row");
  if (commandRow?.querySelector('[data-list-add-more-word="true"]')) return;
  button.insertAdjacentHTML("afterend", renderBanWordsPromptButton(true));
}

function removePromptBanWordButton(button) {
  const commandRow = button.closest(".tweet-list-command-row");
  const feedback = listButtonFeedbackElement(button);
  button.remove();
  feedback?.remove();
  if (!commandRow) return;
  const hasBannedWordUnban = commandRow.querySelector('[data-list-kind="banned_word"][data-list-action="delete"]');
  const addMoreButton = commandRow.querySelector('[data-list-add-more-word="true"]');
  if (!hasBannedWordUnban && addMoreButton) {
    addMoreButton.outerHTML = renderBanWordsPromptButton(false);
  }
}

async function mutateList(kind, action, value, button) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    timelineStatus.textContent = "No list value selected.";
    setListButtonFeedback(button, "No value selected.", "error");
    return;
  }
  const wasReadd = action === "add" && button.dataset.listReadd === "true";
  button.disabled = true;
  const label = listCollectionLabel(kind);
  timelineStatus.textContent = action === "delete" ? `Removing ${normalizedValue} from ${label}...` : `Adding ${normalizedValue} to ${label}...`;
  setListButtonFeedback(button, listPendingFeedback(kind, action, wasReadd));
  const response = await csrfFetch(`/timeline/lists/${encodeURIComponent(kind)}`, {
    method: action === "delete" ? "DELETE" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: normalizedValue })
  });
  if (response.status === 401) {
    button.disabled = false;
    timelineStatus.textContent = "Timeline login required before editing lists.";
    setListButtonFeedback(button, "Login required.", "error");
    return;
  }
  if (!response.ok) {
    button.disabled = false;
    const error = await response.json().catch(() => ({ error: "List update failed" }));
    timelineStatus.textContent = error.error || "List update failed.";
    setListButtonFeedback(button, error.error || "List update failed.", "error");
    return;
  }
  timelineStatus.textContent = action === "delete" ? `Removed ${normalizedValue} from ${label}.` : `Added ${normalizedValue} to ${label}.`;
  if (action === "delete" && kind === "banned_word" && button.dataset.listPromptButton === "true") {
    removePromptBanWordButton(button);
    return;
  }
  setListButtonAction(button, kind, action === "delete" ? "add" : "delete", normalizedValue, { readd: action === "delete" });
  setListButtonFeedback(button, listSuccessFeedback(kind, action, wasReadd), "success");
  if (action === "add" && kind === "banned_word" && button.dataset.listPromptButton === "true") {
    ensureAdditionalBanWordButton(button);
  }
}

async function mutateTimelineItemArchive(button) {
  const action = button.dataset.timelineItemAction;
  const source = button.dataset.timelineItemSource;
  const externalId = button.dataset.timelineItemId;
  if (!source || !externalId || (action !== "archive" && action !== "restore")) {
    timelineStatus.textContent = "Missing timeline item action.";
    return;
  }
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = action === "restore" ? "Adding..." : "Ignoring...";
  timelineStatus.textContent = action === "restore" ? "Adding Reddit post back to Timeline..." : "Ignoring Reddit post...";
  try {
    const response = await csrfFetch(
      `/timeline/items/${encodeURIComponent(source)}/${encodeURIComponent(externalId)}/${action === "restore" ? "restore" : "archive"}`,
      { method: "POST" }
    );
    if (response.status === 401) {
      timelineStatus.textContent = "Timeline login required before editing Reddit items.";
      location.href = "/timeline/login";
      return;
    }
    const result = await response.json().catch(() => ({ error: "Reddit timeline update failed" }));
    if (!response.ok) {
      throw new Error(result.error || "Reddit timeline update failed.");
    }
    timelineStatus.textContent = action === "restore" ? "Reddit post added back to Timeline." : "Reddit post ignored.";
    await refreshTimeline();
  } catch (error) {
    timelineStatus.textContent = error instanceof Error ? error.message : "Reddit timeline update failed.";
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

async function mutateListBatch(kind, action, values, button) {
  const normalizedValues = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  if (normalizedValues.length === 0) {
    timelineStatus.textContent = "No list value selected.";
    setListButtonFeedback(button, "No value selected.", "error");
    return;
  }
  button.disabled = true;
  const label = listCollectionLabel(kind);
  timelineStatus.textContent = action === "delete" ? `Removing ${normalizedValues.length} values from ${label}...` : `Adding ${normalizedValues.length} values to ${label}...`;
  setListButtonFeedback(button, listPendingFeedback(kind, action));
  for (const value of normalizedValues) {
    const response = await csrfFetch(`/timeline/lists/${encodeURIComponent(kind)}`, {
      method: action === "delete" ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value })
    });
    if (response.status === 401) {
      button.disabled = false;
      timelineStatus.textContent = "Timeline login required before editing lists.";
      setListButtonFeedback(button, "Login required.", "error");
      return;
    }
    if (!response.ok) {
      button.disabled = false;
      const error = await response.json().catch(() => ({ error: "List update failed" }));
      timelineStatus.textContent = error.error || "List update failed.";
      setListButtonFeedback(button, error.error || "List update failed.", "error");
      return;
    }
  }
  if (action === "delete") {
    timelineStatus.textContent = `Removed ${normalizedValues.length} values from ${label}.`;
    if (button.dataset.listPromptButton === "true") {
      setListButtonAction(button, kind, "add", "");
    } else {
      button.disabled = false;
    }
    setListButtonFeedback(button, listSuccessFeedback(kind, action, false, normalizedValues.length), "success");
    return;
  }
  timelineStatus.textContent = `Added ${normalizedValues.length} values to ${label}.`;
  setListButtonBatchDeleteAction(button, kind, normalizedValues);
  setListButtonFeedback(button, listSuccessFeedback(kind, action, false, normalizedValues.length), "success");
  if (kind === "banned_word" && button.dataset.listPromptButton === "true") {
    ensureAdditionalBanWordButton(button);
  }
}

timelinePaginations.forEach((paginationNav) => {
  paginationNav.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || !paginationNav.contains(button)) {
      return;
    }
    const pageAction = button.dataset.pageAction;
    if (pageAction) {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      await changeTimelinePage(pageAction);
      return;
    }
    const scrollTop = button.hasAttribute("data-scroll-top");
    if (scrollTop) {
      event.preventDefault();
      event.stopPropagation();
      scrollTimelineToTop("smooth");
    }
  });

  paginationNav.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-page-size]");
    if (!input) return;
    await changeTimelinePageSize(input.value);
  });
});

sourceFilterInputs.forEach((input) => {
  input.addEventListener("change", () => {
    changeTimelineSources().catch((error) => {
      timelineStatus.textContent = error instanceof Error ? error.message : "Timeline source filter failed.";
    });
  });
});
syncSourceFilterInputs();

retryAbsTwimgFailures?.addEventListener("click", () => {
  const confirmed = window.confirm("Retry all timeline media downloads that failed because abs.twimg.com was blocked?\n\nContinue?");
  if (!confirmed) {
    timelineStatus.textContent = "Retry failed media cancelled.";
    return;
  }
  const previousText = retryAbsTwimgFailures.textContent;
  retryAbsTwimgFailures.disabled = true;
  retryAbsTwimgFailures.textContent = "Retrying...";
  timelineStatus.textContent = "Queueing failed media retries...";
  csrfFetch("/admin/media-cache/retry-abs-twimg-failures", { method: "POST" })
    .then(async (response) => {
      if (response.status === 401) {
        timelineStatus.textContent = "Admin login required before retrying failed media.";
        return null;
      }
      const result = await response.json().catch(() => ({ error: "Retry failed media failed" }));
      if (!response.ok) {
        throw new Error(result.error || "Retry failed media failed.");
      }
      if (!result.queued) {
        timelineStatus.textContent = "No abs.twimg.com media failures found to retry.";
        return result;
      }
      timelineStatus.textContent = `Queued ${result.queued} media retry job${result.queued === 1 ? "" : "s"}. Refresh after the worker finishes.`;
      return result;
    })
    .catch((error) => {
      timelineStatus.textContent = error.message || "Unable to retry failed media.";
    })
    .finally(() => {
      retryAbsTwimgFailures.disabled = false;
      retryAbsTwimgFailures.textContent = previousText || "Retry failed media";
    });
});

archiveTimelineButton?.addEventListener("click", () => {
  const sources = timelineState.sources.length > 0 ? timelineState.sources : [...defaultTimelineSources];
  const label = sources.length === defaultTimelineSources.length ? "all timeline items" : sources.join(" and ");
  const confirmed = window.confirm(
    `Archive ${label}?\n\nArchived items will disappear from this timeline but remain stored in the database. Continue?`
  );
  if (!confirmed) {
    timelineStatus.textContent = "Archive cancelled.";
    return;
  }
  const previousText = archiveTimelineButton.textContent;
  archiveTimelineButton.disabled = true;
  archiveTimelineButton.textContent = "Archiving...";
  timelineStatus.textContent = "Archiving timeline items...";
  csrfFetch("/timeline/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources })
  })
    .then(async (response) => {
      if (response.status === 401) {
        location.href = "/timeline/login";
        return null;
      }
      const result = await response.json().catch(() => ({ error: "Archive failed" }));
      if (!response.ok) {
        throw new Error(result.error || "Archive failed.");
      }
      timelineState.offset = 0;
      timelineStatus.textContent = `Archived ${result.total ?? 0} timeline items.`;
      await refreshTimeline();
      return result;
    })
    .catch((error) => {
      timelineStatus.textContent = error instanceof Error ? error.message : "Archive failed.";
    })
    .finally(() => {
      archiveTimelineButton.disabled = false;
      archiveTimelineButton.textContent = previousText;
    });
});

viewArchiveTimelineButton?.addEventListener("click", () => {
  timelineState.archived = !timelineState.archived;
  timelineState.offset = 0;
  updateArchiveControls();
  timelineStatus.textContent = timelineState.archived ? "Loading archived timeline..." : "Loading active timeline...";
  scrollTimelineToTop("auto");
  refreshTimeline().catch((error) => {
    timelineStatus.textContent = error instanceof Error ? error.message : "Timeline failed to load.";
  });
});

restoreArchiveTimelineButton?.addEventListener("click", () => {
  const sources = timelineState.sources.length > 0 ? timelineState.sources : [...defaultTimelineSources];
  const label = sources.length === defaultTimelineSources.length ? "all archived timeline items" : `archived ${sources.join(" and ")}`;
  const confirmed = window.confirm(`Restore ${label}?\n\nRestored items will move back into the active timeline. Continue?`);
  if (!confirmed) {
    timelineStatus.textContent = "Restore cancelled.";
    return;
  }
  const previousText = restoreArchiveTimelineButton.textContent;
  restoreArchiveTimelineButton.disabled = true;
  restoreArchiveTimelineButton.textContent = "Restoring...";
  timelineStatus.textContent = "Restoring archived timeline items...";
  csrfFetch("/timeline/archive/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources })
  })
    .then(async (response) => {
      if (response.status === 401) {
        location.href = "/timeline/login";
        return null;
      }
      const result = await response.json().catch(() => ({ error: "Restore failed" }));
      if (!response.ok) {
        throw new Error(result.error || "Restore failed.");
      }
      timelineState.offset = 0;
      timelineStatus.textContent = `Restored ${result.total ?? 0} timeline items.`;
      await refreshTimeline();
      return result;
    })
    .catch((error) => {
      timelineStatus.textContent = error instanceof Error ? error.message : "Restore failed.";
    })
    .finally(() => {
      restoreArchiveTimelineButton.disabled = false;
      restoreArchiveTimelineButton.textContent = previousText;
    });
});
updateArchiveControls();

timeline.addEventListener("click", async (event) => {
  const externalLink = event.target.closest("[data-external-url]");
  if (externalLink) {
    const url = externalLink.dataset.externalUrl;
    if (!isXUrl(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const confirmed = window.confirm(
      "Warning: opening this link leaves RedqueenX and may expose this browser/network IP to X.\n\nContinue?"
    );
    if (confirmed) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      timelineStatus.textContent = "X link opening cancelled.";
    }
    return;
  }

  const mediaButton = event.target.closest("[data-media-cache-reload]");
  if (mediaButton) {
    const tweetId = mediaButton.dataset.mediaCacheReload;
    setMediaReloadLoading(tweetId, true);
    setTweetInlineStatus(mediaButton, "Loading media through VPN cache...");
    timelineStatus.textContent = "Loading media through VPN namespace...";
    try {
      const response = await csrfFetch(`/timeline/tweets/${encodeURIComponent(tweetId)}/media-cache/reload`, { method: "POST" });
      if (response.status === 401) {
        setTweetInlineStatus(mediaButton, "Timeline login required before loading media.", "error");
        timelineStatus.textContent = "Timeline login required before media can be fetched through VPN.";
        location.href = "/timeline/login";
        return;
      }
      const result = await response.json().catch(() => ({ error: "Media reload failed" }));
      if (!response.ok) {
        setTweetInlineStatus(mediaButton, result.error || "Media reload failed.", "error");
        timelineStatus.textContent = result.error || "Media reload failed.";
        return;
      }
      if (result.queued && result.jobId) {
        setTweetInlineStatus(mediaButton, "Media job queued in Docker VPN worker...", "info");
        timelineStatus.textContent = "Media job queued in Docker VPN worker.";
        const completed = await waitForMediaCacheJob(result.jobId, tweetId, mediaButton);
        if (completed) {
          await refreshTimeline();
        }
      } else {
        setTweetInlineStatus(mediaButton, "Media cache updated. Refreshing timeline...", "success");
        timelineStatus.textContent = "Media loaded through VPN cache.";
        await refreshTimeline();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Media reload failed.";
      setTweetInlineStatus(mediaButton, message, "error");
      timelineStatus.textContent = message;
    } finally {
      setMediaReloadLoading(tweetId, false);
    }
    return;
  }

  const listButton = event.target.closest("[data-list-action]");
  if (listButton) {
    const kind = listButton.dataset.listKind;
    const action = listButton.dataset.listAction;
    let value = listButton.dataset.listValue || "";
    let values = readListButtonValues(listButton);
    if (action === "add" && listButton.dataset.listSource === "prompt") {
      const selected = selectedTextInside(listButton);
      const promptMessage =
        kind === "banned_word_exception"
          ? "Allowed phrase to ignore when checking banned words:"
          : kind === "keyword" || kind === "suggested_keyword"
            ? "Keyword to search:"
          : "Word or phrase to add to banned words:";
      const promptValue = window.prompt(promptMessage, selected) || "";
      values = parsePromptListValues(promptValue);
      value = values[0] || "";
    }
    if (kind !== "banned_word" && kind !== "banned_user" && kind !== "banned_word_exception" && kind !== "keyword" && kind !== "suggested_keyword") {
      timelineStatus.textContent = "Unsupported list action.";
      return;
    }
    try {
      if (values.length > 1) {
        await mutateListBatch(kind, action, values, listButton);
      } else {
        await mutateList(kind, action, value, listButton);
      }
    } catch (error) {
      listButton.disabled = false;
      timelineStatus.textContent = error instanceof Error ? error.message : "List update failed.";
    }
    return;
  }

  const timelineItemButton = event.target.closest("[data-timeline-item-action]");
  if (timelineItemButton) {
    await mutateTimelineItemArchive(timelineItemButton);
    return;
  }

  const button = event.target.closest("[data-tweet-action]");
  if (!button) return;

  const action = button.dataset.tweetAction;
  const tweetId = button.dataset.tweetId;
  button.disabled = true;
  timelineStatus.textContent = `${action === "like" ? "Favorite" : "Retweet"} in progress...`;
  const response = await csrfFetch(`/admin/tweets/${encodeURIComponent(tweetId)}/${action}`, { method: "POST" });
  if (response.status === 401) {
    button.disabled = false;
    timelineStatus.textContent = "Admin action required: log in to Admin.";
    return;
  }
  if (!response.ok) {
    button.disabled = false;
    const error = await response.json().catch(() => ({ error: "Action unavailable" }));
    timelineStatus.textContent = error.error || "Action unavailable.";
    return;
  }
  timelineStatus.textContent = action === "like" ? "Tweet added to favorites." : "Tweet retweeted.";
  await refreshTimeline();
});

timeline.addEventListener("dblclick", (event) => {
  const media = event.target.closest(".tweet-media-item");
  if (!media) return;
  event.preventDefault();
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement === media) {
    document.exitFullscreen?.().catch(() => undefined);
    return;
  }
  const requestFullscreen = media.requestFullscreen?.bind(media);
  if (!requestFullscreen) return;
  requestFullscreen().catch(() => undefined);
});
