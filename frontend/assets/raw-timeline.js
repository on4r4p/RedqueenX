const rawTimeline = document.getElementById("raw-timeline");
const rawTimelineStatus = document.getElementById("raw-timeline-status");
const rawTimelinePaginations = Array.from(document.querySelectorAll("[data-raw-timeline-pagination]"));
const rawTimelineDefaultPageSize = 50;
const rawTimelineMaxPageSize = 300;
const rawTimelineState = {
  offset: readBoundedQueryInt("offset", 0, 0, Number.MAX_SAFE_INTEGER),
  limit: readBoundedQueryInt("limit", rawTimelineDefaultPageSize, 1, rawTimelineMaxPageSize),
  total: 0,
  hasMore: false
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function linkify(text) {
  return escapeHtml(text)
    .replace(/@([A-Za-z0-9_]+)/g, '<span class="mention">@$1</span>')
    .replace(/#([A-Za-z0-9_]+)/g, '<span class="hashtag">#$1</span>');
}

function formatDecision(item) {
  if (item.decisionStatus === "accepted") {
    const notes = Array.isArray(item.rejectionReasons) && item.rejectionReasons.length > 0
      ? `<span>Notes: ${escapeHtml(item.rejectionReasons.join(", "))}</span>`
      : "";
    return `<div class="raw-decision raw-decision-accepted">
      <strong>Accepted</strong>
      <span>Score: ${item.score ?? 0}</span>
      ${notes}
    </div>`;
  }

  if (item.decisionStatus === "rejected") {
    const reasons = Array.isArray(item.rejectionReasons) && item.rejectionReasons.length > 0
      ? item.rejectionReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")
      : "<li>No rejection reason was recorded.</li>";
    return `<div class="raw-decision raw-decision-rejected">
      <strong>Rejected${item.rejectionStage ? ` during ${escapeHtml(item.rejectionStage)}` : ""}</strong>
      <span>${item.score === null || item.score === undefined ? "No score" : `Score: ${item.score}`}</span>
      <ul>${reasons}</ul>
    </div>`;
  }

  return `<div class="raw-decision raw-decision-pending">
    <strong>Decision pending</strong>
    <span>This tweet was captured before scoring and has not been enriched with rejection reasons yet.</span>
  </div>`;
}

async function refreshRawTimeline() {
  const params = new URLSearchParams({
    limit: String(rawTimelineState.limit),
    offset: String(rawTimelineState.offset)
  });
  const response = await fetch(`/raw-timeline/data?${params.toString()}`);
  const data = await response.json();
  const pagination = data.pagination || { total: data.items.length, limit: rawTimelineState.limit, offset: rawTimelineState.offset, hasMore: false };
  if (!data.items.length && pagination.total > 0 && rawTimelineState.offset > 0) {
    rawTimelineState.offset = Math.max(0, Math.floor((pagination.total - 1) / rawTimelineState.limit) * rawTimelineState.limit);
    updateRawTimelineUrl();
    await refreshRawTimeline();
    return;
  }
  rawTimelineState.total = pagination.total;
  rawTimelineState.limit = pagination.limit;
  rawTimelineState.offset = pagination.offset;
  rawTimelineState.hasMore = pagination.hasMore;
  updateRawTimelineUrl();
  renderRawPagination(pagination, data.items.length);
  rawTimelineStatus.textContent = [
    rawPageSummary(pagination, data.items.length),
    "Raw timeline is scoring-free. Every DOM-visible tweet is saved before scoring, then enriched with accepted/rejected status and rejection reasons when scoring finishes. Avatars, media, and external URLs are never loaded directly."
  ]
    .filter(Boolean)
    .join(" ");
  if (!data.items.length) {
    rawTimeline.innerHTML = '<div class="empty-state">No raw Playwright tweets captured yet.</div>';
    return;
  }

  rawTimeline.innerHTML = data.items
    .map((item) => {
      const tweetLink = item.tweetUrl
        ? `<span class="tweet-link external-link-disabled" data-external-url="${escapeAttr(item.tweetUrl)}">Tweet link hidden</span>`
        : "";
      return `<article class="tweet-card raw-tweet-card">
        <div class="avatar avatar-remote-hidden">RAW</div>
        <div class="tweet-body">
          <div class="tweet-meta">
            <strong>${escapeHtml(item.author || "@unknown")}</strong>
            ${item.authorName ? `<span>${escapeHtml(item.authorName)}</span>` : ""}
            <span class="score-pill">raw</span>
            <span class="score-pill ${item.decisionStatus === "rejected" ? "raw-rejected-pill" : item.decisionStatus === "accepted" ? "raw-accepted-pill" : ""}">${escapeHtml(item.decisionStatus || "pending")}</span>
            <span>${escapeHtml(item.keyword)}</span>
          </div>
          <p>${linkify(item.text)} ${tweetLink}</p>
          ${formatDecision(item)}
          <div class="tweet-actions">
            <span>Retweets: ${item.retweetCount ?? 0}</span>
            <span>Favorites: ${item.favoriteCount ?? 0}</span>
            <span>Media: ${item.mediaCount ?? 0} hidden</span>
            <span>URLs: ${item.urlCount ?? 0} hidden</span>
            ${item.tweetCreatedAt ? `<span>${formatDate(item.tweetCreatedAt)}</span>` : ""}
            <span>Captured: ${formatDate(item.capturedAt)}</span>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

refreshRawTimeline();

function rawPageSummary(pagination, itemCount) {
  if (!pagination.total) return "";
  const start = pagination.offset + 1;
  const end = pagination.offset + itemCount;
  return `Showing ${start}-${end} of ${pagination.total}.`;
}

function renderRawPagination(pagination, itemCount) {
  const hasItems = pagination.total > 0;
  for (const paginationNav of rawTimelinePaginations) {
    paginationNav.classList.toggle("is-hidden", !hasItems);
    if (!hasItems) continue;
    const label = paginationNav.querySelector("[data-pagination-label]");
    if (label) label.textContent = rawPageSummary(pagination, itemCount);
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

function clampRawTimelineLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return rawTimelineState.limit;
  return Math.min(rawTimelineMaxPageSize, Math.max(1, Math.floor(limit)));
}

function updateRawTimelineUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("limit", String(rawTimelineState.limit));
  if (rawTimelineState.offset > 0) {
    url.searchParams.set("offset", String(rawTimelineState.offset));
  } else {
    url.searchParams.delete("offset");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

async function changeRawTimelinePage(action) {
  if (action === "prev") {
    rawTimelineState.offset = Math.max(0, rawTimelineState.offset - rawTimelineState.limit);
  } else if (action === "next") {
    rawTimelineState.offset += rawTimelineState.limit;
  } else {
    return;
  }
  rawTimelineStatus.textContent = "Loading raw timeline page...";
  await refreshRawTimeline();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function changeRawTimelinePageSize(value) {
  const nextLimit = clampRawTimelineLimit(value);
  if (nextLimit === rawTimelineState.limit) {
    rawTimelinePaginations.forEach((paginationNav) => {
      const pageSize = paginationNav.querySelector("[data-page-size]");
      if (pageSize) pageSize.value = String(rawTimelineState.limit);
    });
    return;
  }
  rawTimelineState.limit = nextLimit;
  rawTimelineState.offset = 0;
  rawTimelineStatus.textContent = "Loading raw timeline page...";
  await refreshRawTimeline();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

rawTimelinePaginations.forEach((paginationNav) => {
  paginationNav.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-page-action]");
    if (!button || button.disabled) return;
    await changeRawTimelinePage(button.dataset.pageAction);
  });

  paginationNav.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-page-size]");
    if (!input) return;
    await changeRawTimelinePageSize(input.value);
  });
});

rawTimeline.addEventListener("click", (event) => {
  const externalLink = event.target.closest("[data-external-url]");
  if (!externalLink) return;
  const confirmed = window.confirm(
    "Warning: opening this link leaves RedqueenX and may expose this browser/network IP to X.\n\nContinue?"
  );
  if (confirmed) {
    window.open(externalLink.dataset.externalUrl, "_blank", "noopener,noreferrer");
  } else {
    rawTimelineStatus.textContent = "External link opening cancelled.";
  }
});
