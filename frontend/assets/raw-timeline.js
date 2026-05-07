const rawTimeline = document.getElementById("raw-timeline");
const rawTimelineStatus = document.getElementById("raw-timeline-status");

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
  const response = await fetch("/raw-timeline/data?limit=120");
  const data = await response.json();
  rawTimelineStatus.textContent =
    "Raw timeline is scoring-free. Every DOM-visible tweet is saved before scoring, then enriched with accepted/rejected status and rejection reasons when scoring finishes. Avatars, media, and external URLs are never loaded directly.";
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
