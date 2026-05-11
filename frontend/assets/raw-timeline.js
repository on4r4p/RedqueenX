const rawTimeline = document.getElementById("raw-timeline");
const rawTimelineStatus = document.getElementById("raw-timeline-status");
const rawTimelinePaginations = Array.from(document.querySelectorAll("[data-raw-timeline-pagination]"));
const rejectionReasonFilter = document.getElementById("rejection-reason-filter");
const rejectionReasonClear = document.getElementById("rejection-reason-clear");
const rejectedTimelineClearAll = document.getElementById("rejected-timeline-clear-all");
const rawTimelineDefaultPageSize = 50;
const rawTimelineMaxPageSize = 300;
const rawTimelineQueryLimit = readOptionalBoundedQueryInt("limit", 1, rawTimelineMaxPageSize);
const rawTimelineState = {
  offset: readBoundedQueryInt("offset", 0, 0, Number.MAX_SAFE_INTEGER),
  limit: rawTimelineQueryLimit ?? rawTimelineDefaultPageSize,
  customLimit: rawTimelineQueryLimit !== null,
  reasons: readStringListQuery("reason"),
  reasonGroups: readStringListQuery("reasonGroup"),
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

function rejectionReasonGroupId(reason) {
  const value = String(reason || "");
  if (value === "banned_word" || value.startsWith("banned_word:")) return "banned_word";
  if (value === "banned_user" || value.startsWith("banned_user:")) return "banned_user";
  if (value === "tweet_too_old" || value.startsWith("tweet_too_old:")) return "tweet_too_old";
  if (value === "tweet_too_short") return "tweet_too_short";
  if (value === "language_unknown" || value === "language_not_allowed" || value.startsWith("language_not_allowed:")) return "language";
  if (value === "tweet_id_already_seen" || value === "tweet_text_already_seen" || value.startsWith("tweet_text_too_similar:")) return "duplicate";
  if (value === "missing_keyword") return "missing_keyword";
  if (value === "too_many_hashtags" || value.startsWith("too_many_hashtags:")) return "hashtags";
  if (value === "too_many_mentions" || value.startsWith("too_many_mentions:")) return "mentions";
  if (value === "too_many_tweets_by_user") return "user_frequency";
  if (value === "not_enough_retweets" || value === "too_many_retweets" || value.startsWith("not_enough_retweets:") || value.startsWith("too_many_retweets:")) return "retweets";
  if (value === "not_enough_favorites" || value === "too_many_favorites" || value.startsWith("not_enough_favorites:") || value.startsWith("too_many_favorites:")) return "favorites";
  if (value === "not_enough_followers" || value.startsWith("not_enough_followers:")) return "followers";
  if (value === "score_too_low") return "score";
  if (value === "prefilter_rejected") return "prefilter";
  return "";
}

function reasonMatchesActiveRejectionFilters(reason) {
  if (!hasActiveRejectionFilters()) return true;
  const value = String(reason || "");
  if (rawTimelineState.reasons.includes(value)) return true;
  const groupId = rejectionReasonGroupId(value);
  return groupId ? rawTimelineState.reasonGroups.includes(groupId) : false;
}

function visibleRejectionReasons(reasons) {
  const values = Array.isArray(reasons) ? reasons : [];
  return hasActiveRejectionFilters() ? values.filter(reasonMatchesActiveRejectionFilters) : values;
}

function formatDecision(item) {
  if (item.decisionStatus === "accepted") {
    const reasons = Array.isArray(item.rejectionReasons) ? item.rejectionReasons : [];
    const luckReason = luckFactorReason(reasons);
    const normalNotes = luckReason ? reasons.filter((reason) => reason !== luckReason) : reasons;
    const luck = luckReason ? `<span>${formatLuckFactorLabel(luckReason)}</span>` : "";
    const notes = normalNotes.length > 0
      ? `<span>${luckReason ? "Original reasons" : "Notes"}: ${escapeHtml(normalNotes.join(", "))}</span>`
      : "";
    return `<div class="raw-decision raw-decision-accepted">
      <strong>${luckReason ? "Accepted by luck factor" : "Accepted"}</strong>
      <span>Score: ${item.score ?? 0}</span>
      ${luck}
      ${notes}
    </div>`;
  }

  if (item.decisionStatus === "rejected") {
    const reasons = visibleRejectionReasons(item.rejectionReasons);
    const reasonList = reasons.length > 0
      ? reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")
      : hasActiveRejectionFilters()
        ? "<li>No selected rejection reason was recorded.</li>"
        : "<li>No rejection reason was recorded.</li>";
    return `<div class="raw-decision raw-decision-rejected">
      <strong>Rejected${item.rejectionStage ? ` during ${escapeHtml(item.rejectionStage)}` : ""}</strong>
      <span>${item.score === null || item.score === undefined ? "No score" : `Score: ${item.score}`}</span>
      <ul>${reasonList}</ul>
    </div>`;
  }

  return `<div class="raw-decision raw-decision-pending">
    <strong>Decision pending</strong>
    <span>This tweet was captured before scoring and has not been enriched with rejection reasons yet.</span>
  </div>`;
}

function renderRejectedListButtons(item) {
  if (item.decisionStatus !== "rejected") return "";
  const reasons = Array.isArray(item.rejectionReasons) ? item.rejectionReasons : [];
  const bannedWords = reasons
    .filter((reason) => reason.startsWith("banned_word:"))
    .map((reason) => reason.slice("banned_word:".length).trim())
    .filter(Boolean);
  const buttons = bannedWords.map((word) =>
    `<button type="button" class="tweet-action-button tweet-list-button" data-list-action="delete" data-list-kind="banned_word" data-list-value="${escapeAttr(word)}" title="Remove ${escapeAttr(word)} from banned words.">${rawListActionText("banned_word", "delete", word)}</button>`
  );
  const bannedUserReason = reasons.find((reason) => reason === "banned_user" || reason.startsWith("banned_user:"));
  if (bannedUserReason) {
    const reasonUser = bannedUserReason.startsWith("banned_user:") ? bannedUserReason.slice("banned_user:".length).trim() : "";
    const user = formatHandleForList(reasonUser || item.author);
    if (user) {
      buttons.push(
        `<button type="button" class="tweet-action-button tweet-list-button" data-list-action="delete" data-list-kind="banned_user" data-list-value="${escapeAttr(user)}" title="Remove ${escapeAttr(user)} from banned users.">${rawListActionText("banned_user", "delete", user)}</button>`
      );
    }
  }
  buttons.push(
    '<button type="button" class="tweet-action-button tweet-list-button" data-list-action="add" data-list-kind="banned_word" data-list-source="prompt" data-list-prompt-button="true" title="Add one or more words to banned words. Separate multiple values with commas, semicolons, or new lines.">Ban some words</button>'
  );
  return `<div class="tweet-command-row tweet-list-command-row">${buttons.join("")}</div>`;
}

async function refreshRawTimeline() {
  const params = new URLSearchParams({
    offset: String(rawTimelineState.offset)
  });
  if (rawTimelineState.customLimit) {
    params.set("limit", String(rawTimelineState.limit));
  }
  for (const reason of rawTimelineState.reasons) {
    params.append("reason", reason);
  }
  for (const reasonGroup of rawTimelineState.reasonGroups) {
    params.append("reasonGroup", reasonGroup);
  }
  const response = await fetch(`/rejected-timeline/data?${params.toString()}`);
  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : [];
  rawTimelineState.reasons = data.selectedRejectionReasons || rawTimelineState.reasons;
  rawTimelineState.reasonGroups = data.selectedRejectionReasonGroups || rawTimelineState.reasonGroups;
  const rejectionReasonGroups = data.availableRejectionReasonGroups || [];
  renderRejectionReasonFilter(rejectionReasonGroups, rawTimelineState.reasonGroups);
  const pagination = data.pagination || { total: items.length, limit: rawTimelineState.limit, offset: rawTimelineState.offset, hasMore: false };
  if (data.enabled === false) {
    rawTimelineState.total = 0;
    rawTimelineState.limit = pagination.limit;
    rawTimelineState.offset = 0;
    rawTimelineState.hasMore = false;
    updateRawTimelineUrl();
    renderRawPagination({ total: 0, limit: pagination.limit, offset: 0, hasMore: false }, 0);
    rawTimelineStatus.textContent = "Rejected timeline is disabled in Settings.";
    rawTimeline.innerHTML = '<div class="empty-state">Rejected timeline is disabled in Settings.</div>';
    return;
  }
  if (!items.length && pagination.total > 0 && rawTimelineState.offset > 0) {
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
  renderRawPagination(pagination, items.length);
  const activeFilters = activeRejectionFilterLabels(rejectionReasonGroups);
  rawTimelineStatus.textContent = [
    rawPageSummary(pagination, items.length),
    activeFilters.length ? `Filtered by: ${activeFilters.join(", ")}.` : "",
    "Rejected timeline shows captured tweets rejected by prefiltering or scoring. Avatars, media, and external URLs are never loaded directly."
  ]
    .filter(Boolean)
    .join(" ");
  if (!items.length) {
    rawTimeline.innerHTML = hasActiveRejectionFilters()
      ? '<div class="empty-state">No rejected tweets match the selected reasons.</div>'
      : '<div class="empty-state">No rejected tweets captured yet.</div>';
    return;
  }

  rawTimeline.innerHTML = items
    .map((item) => {
      const tweetLink = item.tweetUrl
        ? `<span class="tweet-link external-link-disabled" data-external-url="${escapeAttr(item.tweetUrl)}">Tweet link hidden</span>`
        : "";
      return `<article class="tweet-card raw-tweet-card">
        <div class="avatar avatar-remote-hidden">REJ</div>
        <div class="tweet-body">
          <div class="tweet-meta">
            <strong>${escapeHtml(item.author || "@unknown")}</strong>
            ${item.authorName ? `<span>${escapeHtml(item.authorName)}</span>` : ""}
            <span class="score-pill">captured</span>
            <span class="score-pill ${item.decisionStatus === "rejected" ? "raw-rejected-pill" : item.decisionStatus === "accepted" ? "raw-accepted-pill" : ""}">${escapeHtml(item.decisionStatus || "pending")}</span>
            ${renderLuckFactorBadge(item.rejectionReasons)}
          </div>
          <p>${linkify(item.text)} ${tweetLink}</p>
          ${formatDecision(item)}
          <div class="tweet-actions">
            <span>Keyword: ${escapeHtml(item.keyword)}</span>
            <span>Retweets: ${item.retweetCount ?? 0}</span>
            <span>Favorites: ${item.favoriteCount ?? 0}</span>
            <span>Media: ${item.mediaCount ?? 0} hidden</span>
            <span>URLs: ${item.urlCount ?? 0} hidden</span>
            ${item.tweetCreatedAt ? `<span>${formatDate(item.tweetCreatedAt)}</span>` : ""}
            <span>Captured: ${formatDate(item.capturedAt)}</span>
          </div>
          ${renderRejectedListButtons(item)}
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

function readOptionalBoundedQueryInt(name, min, max) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(name)) return null;
  const value = Number(params.get(name));
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function readStringListQuery(name) {
  const params = new URLSearchParams(window.location.search);
  return Array.from(new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean)));
}

function clampRawTimelineLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return rawTimelineState.limit;
  return Math.min(rawTimelineMaxPageSize, Math.max(1, Math.floor(limit)));
}

function updateRawTimelineUrl() {
  const url = new URL(window.location.href);
  if (rawTimelineState.customLimit) {
    url.searchParams.set("limit", String(rawTimelineState.limit));
  } else {
    url.searchParams.delete("limit");
  }
  if (rawTimelineState.offset > 0) {
    url.searchParams.set("offset", String(rawTimelineState.offset));
  } else {
    url.searchParams.delete("offset");
  }
  url.searchParams.delete("reason");
  for (const reason of rawTimelineState.reasons) {
    url.searchParams.append("reason", reason);
  }
  url.searchParams.delete("reasonGroup");
  for (const reasonGroup of rawTimelineState.reasonGroups) {
    url.searchParams.append("reasonGroup", reasonGroup);
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
  rawTimelineStatus.textContent = "Loading rejected timeline page...";
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
  rawTimelineState.customLimit = true;
  rawTimelineState.offset = 0;
  rawTimelineStatus.textContent = "Loading rejected timeline page...";
  await refreshRawTimeline();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderRejectionReasonFilter(options, selectedReasonGroups) {
  if (!rejectionReasonFilter) return;
  const selected = new Set((selectedReasonGroups || []).map(String));
  const reasonGroupOptions = Array.isArray(options) ? options : [];
  rejectionReasonFilter.innerHTML = reasonGroupOptions.length
    ? reasonGroupOptions
        .map((option) => {
          const id = String(option.id || "");
          const label = String(option.label || id);
          const count = Number(option.count || 0);
          const checkedAttr = selected.has(id) ? " checked" : "";
          return `<label class="timeline-filter-option">
            <input type="checkbox" data-reason-group="${escapeAttr(id)}"${checkedAttr} />
            <span>${escapeHtml(label)} <span class="timeline-filter-count">(${count})</span></span>
          </label>`;
        })
        .join("")
    : '<span class="timeline-filter-empty">No rejection reasons yet</span>';
  if (rejectionReasonClear) {
    rejectionReasonClear.disabled = !hasActiveRejectionFilters();
  }
}

async function changeRejectionReasonFilter() {
  if (!rejectionReasonFilter) return;
  rawTimelineState.reasonGroups = Array.from(rejectionReasonFilter.querySelectorAll("[data-reason-group]:checked"))
    .map((input) => input.dataset.reasonGroup)
    .filter(Boolean);
  rawTimelineState.offset = 0;
  rawTimelineStatus.textContent = "Loading rejected timeline page...";
  await refreshRawTimeline();
}

function activeRejectionFilterLabels(options) {
  const labelsById = new Map((Array.isArray(options) ? options : []).map((option) => [String(option.id || ""), String(option.label || option.id || "")]));
  const groupLabels = rawTimelineState.reasonGroups.map((id) => labelsById.get(id) || id);
  return [...groupLabels, ...rawTimelineState.reasons];
}

function hasActiveRejectionFilters() {
  return rawTimelineState.reasonGroups.length > 0 || rawTimelineState.reasons.length > 0;
}

function formatHandleForList(value) {
  const handle = String(value || "").trim();
  if (!handle) return "";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function selectedTextInsideRaw(button) {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return "";
  const card = button.closest(".tweet-card");
  const anchor = selection.anchorNode;
  if (card && anchor && !card.contains(anchor)) return "";
  return selection.toString().replace(/\s+/g, " ").trim().slice(0, 160);
}

function shortRawListButtonValue(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 32 ? `${normalized.slice(0, 29)}...` : normalized;
}

function rawListActionText(kind, action, value = "") {
  const target = kind === "banned_user" ? "user" : "word";
  const displayValue = shortRawListButtonValue(value);
  if (action === "delete") return displayValue ? `Unban ${displayValue}` : `Unban ${target}`;
  return displayValue ? `Ban ${displayValue}` : `Ban ${target}`;
}

function rawListButtonText(button, kind, action, value = "") {
  const target = kind === "banned_user" ? "user" : "word";
  const displayValue = shortRawListButtonValue(value || button.dataset.listValue);
  if (action === "add" && kind === "banned_word" && !displayValue && button.dataset.listPromptButton === "true") return "Ban some words";
  if (action === "delete") return displayValue ? `Unban ${displayValue}` : `Unban ${target}`;
  if (button.dataset.listReadd === "true") return displayValue ? `Reban ${displayValue}` : `Reban ${target}`;
  return displayValue ? `Ban ${displayValue}` : `Ban ${target}`;
}

function parseRawPromptListValues(value) {
  return Array.from(new Set(String(value || "").split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))).slice(0, 50);
}

function readRawListButtonValues(button) {
  if (!button.dataset.listValues) return [];
  try {
    const values = JSON.parse(button.dataset.listValues);
    return Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function setRawListButtonFeedback(button, message, tone = "info") {
  let feedback = button.nextElementSibling;
  if (!feedback || feedback.dataset.listButtonFeedback !== "true") {
    feedback = document.createElement("span");
    feedback.dataset.listButtonFeedback = "true";
    feedback.className = "tweet-list-feedback";
    button.after(feedback);
  }
  feedback.classList.toggle("is-error", tone === "error");
  feedback.classList.toggle("is-success", tone === "success");
  feedback.textContent = message;
}

function setRawListButtonAction(button, kind, action, value, options = {}) {
  const normalizedValue = String(value || "").trim();
  button.dataset.listKind = kind;
  button.dataset.listAction = action;
  if (normalizedValue) {
    button.dataset.listValue = normalizedValue;
    delete button.dataset.listValues;
    delete button.dataset.listSource;
  } else if (kind === "banned_word") {
    delete button.dataset.listValue;
    delete button.dataset.listValues;
    button.dataset.listSource = "prompt";
  }
  if (action === "add" && options.readd) {
    button.dataset.listReadd = "true";
  } else {
    delete button.dataset.listReadd;
  }
  button.textContent = rawListButtonText(button, kind, action, normalizedValue);
  button.disabled = false;

  const label = kind === "banned_user" ? "banned users" : "banned words";
  button.title =
    action === "delete"
      ? `Remove ${normalizedValue} from ${label}.`
      : options.readd
        ? `Add ${normalizedValue} back to ${label}.`
      : normalizedValue
        ? `Add ${normalizedValue} to ${label}.`
      : "Add one or more words to banned words. Separate multiple values with commas, semicolons, or new lines.";
}

function setRawListButtonBatchDeleteAction(button, kind, values) {
  const normalizedValues = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  button.dataset.listKind = kind;
  button.dataset.listAction = "delete";
  button.dataset.listValues = JSON.stringify(normalizedValues);
  delete button.dataset.listValue;
  delete button.dataset.listSource;
  delete button.dataset.listReadd;
  button.textContent = `Unban ${normalizedValues.length} ${kind === "banned_user" ? "users" : "words"}`;
  button.title = `Remove ${normalizedValues.join(", ")} from ${kind === "banned_user" ? "banned users" : "banned words"}.`;
  button.disabled = false;
}

async function mutateList(kind, action, value, button) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    rawTimelineStatus.textContent = "No list value selected.";
    setRawListButtonFeedback(button, "No value selected.", "error");
    return;
  }
  const wasReadd = action === "add" && button.dataset.listReadd === "true";
  button.disabled = true;
  rawTimelineStatus.textContent = action === "delete" ? `Removing ${normalizedValue} from ${kind}...` : `Adding ${normalizedValue} to ${kind}...`;
  setRawListButtonFeedback(button, action === "delete" ? "Removing..." : wasReadd ? "Rebanning..." : "Banning...");
  const response = await fetch(`/admin/lists/${encodeURIComponent(kind)}`, {
    method: action === "delete" ? "DELETE" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: normalizedValue })
  });
  if (response.status === 401) {
    button.disabled = false;
    rawTimelineStatus.textContent = "Admin login required before editing lists.";
    setRawListButtonFeedback(button, "Login required.", "error");
    return;
  }
  if (!response.ok) {
    button.disabled = false;
    const error = await response.json().catch(() => ({ error: "List update failed" }));
    rawTimelineStatus.textContent = error.error || "List update failed.";
    setRawListButtonFeedback(button, error.error || "List update failed.", "error");
    return;
  }
  const label = kind === "banned_user" ? "banned users" : "banned words";
  rawTimelineStatus.textContent = action === "delete" ? `Removed ${normalizedValue} from ${label}.` : `Added ${normalizedValue} to ${label}.`;
  setRawListButtonAction(button, kind, action === "delete" ? "add" : "delete", normalizedValue, { readd: action === "delete" });
  if (action === "delete" && button.dataset.listPromptButton === "true") {
    setRawListButtonAction(button, kind, "add", "");
  }
  const successMessage = action === "delete" ? "Unbanned." : wasReadd ? "Rebanned." : "Banned.";
  setRawListButtonFeedback(button, successMessage, "success");
}

async function mutateListBatch(kind, action, values, button) {
  const normalizedValues = Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  if (normalizedValues.length === 0) {
    rawTimelineStatus.textContent = "No list value selected.";
    setRawListButtonFeedback(button, "No value selected.", "error");
    return;
  }
  button.disabled = true;
  const label = kind === "banned_user" ? "banned users" : "banned words";
  rawTimelineStatus.textContent = action === "delete" ? `Removing ${normalizedValues.length} values from ${kind}...` : `Adding ${normalizedValues.length} values to ${kind}...`;
  setRawListButtonFeedback(button, action === "delete" ? "Removing..." : "Banning...");
  for (const value of normalizedValues) {
    const response = await fetch(`/admin/lists/${encodeURIComponent(kind)}`, {
      method: action === "delete" ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value })
    });
    if (response.status === 401) {
      button.disabled = false;
      rawTimelineStatus.textContent = "Admin login required before editing lists.";
      setRawListButtonFeedback(button, "Login required.", "error");
      return;
    }
    if (!response.ok) {
      button.disabled = false;
      const error = await response.json().catch(() => ({ error: "List update failed" }));
      rawTimelineStatus.textContent = error.error || "List update failed.";
      setRawListButtonFeedback(button, error.error || "List update failed.", "error");
      return;
    }
  }
  if (action === "delete") {
    rawTimelineStatus.textContent = `Removed ${normalizedValues.length} values from ${label}.`;
    if (button.dataset.listPromptButton === "true") {
      setRawListButtonAction(button, kind, "add", "");
    } else {
      button.disabled = false;
    }
    setRawListButtonFeedback(button, "Unbanned.", "success");
    return;
  }
  rawTimelineStatus.textContent = `Added ${normalizedValues.length} values to ${label}.`;
  setRawListButtonBatchDeleteAction(button, kind, normalizedValues);
  setRawListButtonFeedback(button, `Banned ${normalizedValues.length}.`, "success");
}

rawTimelinePaginations.forEach((paginationNav) => {
  paginationNav.addEventListener("click", async (event) => {
    const scrollTop = event.target.closest("[data-scroll-top]");
    if (scrollTop) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
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

rejectionReasonFilter?.addEventListener("change", () => {
  changeRejectionReasonFilter().catch((error) => {
    rawTimelineStatus.textContent = error.message || "Unable to filter rejected timeline.";
  });
});

rejectionReasonClear?.addEventListener("click", () => {
  rawTimelineState.reasons = [];
  rawTimelineState.reasonGroups = [];
  rawTimelineState.offset = 0;
  if (rejectionReasonFilter) {
    for (const input of rejectionReasonFilter.querySelectorAll("[data-reason-group]")) {
      input.checked = false;
    }
  }
  rawTimelineStatus.textContent = "Loading rejected timeline page...";
  refreshRawTimeline().catch((error) => {
    rawTimelineStatus.textContent = error.message || "Unable to clear rejected timeline filters.";
  });
});

rejectedTimelineClearAll?.addEventListener("click", () => {
  const confirmed = window.confirm("Delete all rejected timeline entries? This cannot be undone.\n\nContinue?");
  if (!confirmed) {
    rawTimelineStatus.textContent = "Clear rejected timeline cancelled.";
    return;
  }
  const previousText = rejectedTimelineClearAll.textContent;
  rejectedTimelineClearAll.disabled = true;
  rejectedTimelineClearAll.textContent = "Clearing...";
  rawTimelineStatus.textContent = "Clearing rejected timeline...";
  fetch("/admin/rejected-timeline", { method: "DELETE" })
    .then(async (response) => {
      if (response.status === 401) {
        rawTimelineStatus.textContent = "Admin login required before clearing rejected timeline.";
        return null;
      }
      const result = await response.json().catch(() => ({ error: "Clear rejected timeline failed" }));
      if (!response.ok) {
        throw new Error(result.error || "Clear rejected timeline failed.");
      }
      rawTimelineState.offset = 0;
      rawTimelineState.reasons = [];
      rawTimelineState.reasonGroups = [];
      await refreshRawTimeline();
      rawTimelineStatus.textContent = `Deleted ${result.deleted ?? 0} rejected timeline entr${result.deleted === 1 ? "y" : "ies"}.`;
      return result;
    })
    .catch((error) => {
      rawTimelineStatus.textContent = error.message || "Unable to clear rejected timeline.";
    })
    .finally(() => {
      rejectedTimelineClearAll.disabled = false;
      rejectedTimelineClearAll.textContent = previousText || "Clear rejected timeline";
    });
});

rawTimeline.addEventListener("click", (event) => {
  const listButton = event.target.closest("[data-list-action]");
  if (listButton) {
    const kind = listButton.dataset.listKind;
    const action = listButton.dataset.listAction;
    let value = listButton.dataset.listValue || "";
    let values = readRawListButtonValues(listButton);
    if (action === "add" && listButton.dataset.listSource === "prompt") {
      const selected = selectedTextInsideRaw(listButton);
      const promptValue = window.prompt("Words or phrases to add to banned words. Separate multiple values with commas, semicolons, or new lines:", selected) || "";
      values = parseRawPromptListValues(promptValue);
      value = values[0] || "";
    }
    if (kind !== "banned_word" && kind !== "banned_user") {
      rawTimelineStatus.textContent = "Unsupported list action.";
      return;
    }
    const mutation = values.length > 1 ? mutateListBatch(kind, action, values, listButton) : mutateList(kind, action, value, listButton);
    mutation.catch((error) => {
      listButton.disabled = false;
      rawTimelineStatus.textContent = error.message || "List update failed.";
    });
    return;
  }

  const externalLink = event.target.closest("[data-external-url]");
  if (!externalLink) return;
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
    rawTimelineStatus.textContent = "X link opening cancelled.";
  }
});
