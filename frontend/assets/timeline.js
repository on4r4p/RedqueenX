const timeline = document.getElementById("timeline");
const timelineStatus = document.getElementById("timeline-status");
const timelinePaginations = Array.from(document.querySelectorAll("[data-timeline-pagination]"));
const timelineDefaultPageSize = 50;
const timelineMaxPageSize = 200;
const timelineState = {
  offset: readBoundedQueryInt("offset", 0, 0, Number.MAX_SAFE_INTEGER),
  limit: readBoundedQueryInt("limit", timelineDefaultPageSize, 1, timelineMaxPageSize),
  total: 0,
  hasMore: false
};

function avatarText(author) {
  if (!author) return "RQ";
  return author.slice(0, 2).toUpperCase();
}

function linkify(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /(https?:\/\/\S+)/g,
      '<span class="external-link-disabled" data-external-url="$1" title="Click to show a warning before opening this external URL.">$1</span>'
    )
    .replace(/@([A-Za-z0-9_]+)/g, '<span class="mention">@$1</span>')
    .replace(/#([A-Za-z0-9_]+)/g, '<span class="hashtag">#$1</span>');
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      return `<div class="tweet-media-placeholder" title="Remote media is not loaded by the timeline to avoid direct IP exposure.">
        <strong>${label}</strong>
        <span>${escapeAttr(media.lastError || media.altText || media.type || `media ${index + 1}`)}</span>
      </div>`;
    })
    .join("");
  const needsReload = mediaItems.some((media) => media.hasRemoteSource && media.cacheStatus !== "cached" && media.cacheStatus !== "disabled");
  const reloadButton = needsReload
    ? `<div class="tweet-command-row"><button type="button" class="tweet-action-button" data-media-cache-reload="${escapeAttr(item.tweetId)}">Reload media through VPN</button></div>`
    : "";
  return `<div class="tweet-media-grid">${html}</div>${reloadButton}`;
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

function renderMetrics(item) {
  const retweets = item.retweetCount ?? 0;
  const favorites = item.favoriteCount ?? 0;
  const score = item.score ?? "legacy";
  return `<div class="tweet-actions">
    <span>Retweets: ${retweets}</span>
    <span>Favorites: ${favorites}</span>
    <span>Score: ${score}</span>
    ${item.tweetCreatedAt ? `<span>${formatDate(item.tweetCreatedAt)}</span>` : ""}
  </div>`;
}

async function refreshTimeline() {
  const params = new URLSearchParams({
    limit: String(timelineState.limit),
    offset: String(timelineState.offset)
  });
  const response = await fetch(`/timeline/data?${params.toString()}`);
  const data = await response.json();
  const pagination = data.pagination || { total: data.items.length, limit: timelineState.limit, offset: timelineState.offset, hasMore: false };
  if (!data.items.length && pagination.total > 0 && timelineState.offset > 0) {
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
  renderPagination(pagination, data.items.length);
  timelineStatus.textContent = [
    pageSummary(pagination, data.items.length),
    "Remote avatars, media, and external links are not loaded directly. Cached media is served locally from /media-cache only."
  ]
    .filter(Boolean)
    .join(" ");
  if (!data.items.length) {
    timeline.innerHTML = '<div class="empty-state">No imported data. Go to Admin, then run the legacy import.</div>';
    return;
  }

  timeline.innerHTML = data.items
    .map((item) => {
      const author = item.author || "legacy";
      const tweetLink = item.tweetUrl
        ? `<span class="tweet-link external-link-disabled" data-external-url="${escapeAttr(item.tweetUrl)}" title="Click to show a warning before opening X.">Tweet link hidden</span>`
        : "";
      return `<article class="tweet-card">
        ${renderAvatar(item, author)}
        <div class="tweet-body">
          <div class="tweet-meta">
            <strong>${author}</strong>
            ${item.authorName ? `<span>${item.authorName}</span>` : ""}
            ${item.lineNumber ? `<span>Text.Sent line ${item.lineNumber}</span>` : ""}
            <span class="score-pill">${item.source || "legacy"}</span>
          </div>
          <p>${linkify(item.text)} ${tweetLink}</p>
          ${renderMedia(item)}
          ${renderMetrics(item)}
          ${renderTweetButtons(item, data.actionsEnabled)}
        </div>
      </article>`;
    })
    .join("");
}

refreshTimeline();

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

function clampTimelineLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return timelineState.limit;
  return Math.min(timelineMaxPageSize, Math.max(1, Math.floor(limit)));
}

function updateTimelineUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("limit", String(timelineState.limit));
  if (timelineState.offset > 0) {
    url.searchParams.set("offset", String(timelineState.offset));
  } else {
    url.searchParams.delete("offset");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

async function changeTimelinePage(action) {
  if (action === "prev") {
    timelineState.offset = Math.max(0, timelineState.offset - timelineState.limit);
  } else if (action === "next") {
    timelineState.offset += timelineState.limit;
  } else {
    return;
  }
  timelineStatus.textContent = "Loading timeline page...";
  await refreshTimeline();
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  timelineState.offset = 0;
  timelineStatus.textContent = "Loading timeline page...";
  await refreshTimeline();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

timelinePaginations.forEach((paginationNav) => {
  paginationNav.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-page-action]");
    if (!button || button.disabled) return;
    await changeTimelinePage(button.dataset.pageAction);
  });

  paginationNav.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-page-size]");
    if (!input) return;
    await changeTimelinePageSize(input.value);
  });
});

timeline.addEventListener("click", async (event) => {
  const externalLink = event.target.closest("[data-external-url]");
  if (externalLink) {
    const url = externalLink.dataset.externalUrl;
    const confirmed = window.confirm(
      "Warning: opening this link leaves RedqueenX and may expose this browser/network IP to X or the external site.\n\nContinue?"
    );
    if (confirmed) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      timelineStatus.textContent = "External link opening cancelled.";
    }
    return;
  }

  const mediaButton = event.target.closest("[data-media-cache-reload]");
  if (mediaButton) {
    const tweetId = mediaButton.dataset.mediaCacheReload;
    mediaButton.disabled = true;
    timelineStatus.textContent = "Reloading media through VPN namespace...";
    const response = await fetch(`/admin/tweets/${encodeURIComponent(tweetId)}/media-cache/reload`, { method: "POST" });
    if (response.status === 401) {
      mediaButton.disabled = false;
      timelineStatus.textContent = "Admin login required before media can be fetched through VPN.";
      return;
    }
    if (!response.ok) {
      mediaButton.disabled = false;
      const error = await response.json().catch(() => ({ error: "Media reload failed" }));
      timelineStatus.textContent = error.error || "Media reload failed.";
      return;
    }
    timelineStatus.textContent = "Media cache refreshed through VPN.";
    await refreshTimeline();
    return;
  }

  const button = event.target.closest("[data-tweet-action]");
  if (!button) return;

  const action = button.dataset.tweetAction;
  const tweetId = button.dataset.tweetId;
  button.disabled = true;
  timelineStatus.textContent = `${action === "like" ? "Favorite" : "Retweet"} in progress...`;
  const response = await fetch(`/admin/tweets/${encodeURIComponent(tweetId)}/${action}`, { method: "POST" });
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
