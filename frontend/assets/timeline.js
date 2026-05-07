const timeline = document.getElementById("timeline");
const timelineStatus = document.getElementById("timeline-status");

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
  const response = await fetch("/timeline/data?limit=40");
  const data = await response.json();
  timelineStatus.textContent = "Remote avatars, media, and external links are not loaded directly. Cached media is served locally from /media-cache only.";
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
