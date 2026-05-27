const statusLine = document.getElementById("status-line");
const adminNavMore = document.getElementById("admin-nav-more");
const metrics = document.getElementById("metrics");
const countersUpdatedAt = document.getElementById("counters-updated-at");
const sessionKeywordWarning = document.getElementById("session-keyword-warning");
const runPreviewRefreshButton = document.getElementById("run-preview-refresh-button");
const runPreviewSummary = document.getElementById("run-preview-summary");
const runPreviewList = document.getElementById("run-preview-list");
const runPreviewOpenState = new Set();
const systemHealthRefreshButton = document.getElementById("system-health-refresh-button");
const systemHealthUpdated = document.getElementById("system-health-updated");
const systemHealthSummary = document.getElementById("system-health-summary");
const systemHealthServices = document.getElementById("system-health-services");
const systemHealthSsh = document.getElementById("system-health-ssh");
const systemHealthWeb = document.getElementById("system-health-web");
const systemHealthRuntime = document.getElementById("system-health-runtime");
const runStatusLine = document.getElementById("run-status-line");
const rawTimelineLinks = Array.from(document.querySelectorAll("[data-raw-timeline-link]"));
const xSessionAlertHeader = document.getElementById("x-session-alert-header");
const xSessionAlertTitle = document.getElementById("x-session-alert-title");
const xSessionAlertDetail = document.getElementById("x-session-alert-detail");
const xSessionAlertCommands = document.getElementById("x-session-alert-commands");
const xSessionAlertLogin = document.getElementById("x-session-alert-login");
const xSessionAlertLoginStatus = document.getElementById("x-session-alert-login-status");
const xSessionAlertNote = document.getElementById("x-session-alert-note");
const xSessionAlertIgnore = document.getElementById("x-session-alert-ignore");
const xSessionAlertResolve = document.getElementById("x-session-alert-resolve");
const sessionAlertsRefreshButton = document.getElementById("session-alerts-refresh-button");
const sessionAlertsSummary = document.getElementById("session-alerts-summary");
const sessionAlertsCount = document.getElementById("session-alerts-count");
const sessionAlertsList = document.getElementById("session-alerts-list");
const sessionAlertDetail = document.getElementById("session-alert-detail");
const sessionAlertDetailNote = document.getElementById("session-alert-detail-note");
const sessionAlertDetailLogin = document.getElementById("session-alert-detail-login");
const sessionAlertDetailLoginStatus = document.getElementById("session-alert-detail-login-status");
const sessionAlertDetailIgnore = document.getElementById("session-alert-detail-ignore");
const sessionAlertDetailResolve = document.getElementById("session-alert-detail-resolve");
const editKind = document.getElementById("edit-kind");
const entryValue = document.getElementById("entry-value");
const selectedEntryLine = document.getElementById("selected-entry-line");
const saveSelectedButton = document.getElementById("save-selected-button");
const deleteSelectedButton = document.getElementById("delete-selected-button");
const clearSelectionButton = document.getElementById("clear-selection-button");
const downloadListButton = document.getElementById("download-list-button");
const cleanupListsButton = document.getElementById("cleanup-lists-button");
const deleteAllListButton = document.getElementById("delete-all-list-button");
const promoteAllSuggestedKeywordsButton = document.getElementById("promote-all-suggested-keywords-button");
const activeListLabel = document.getElementById("active-list-label");
const listSearch = document.getElementById("list-search");
const listSearchMatches = document.getElementById("list-search-matches");
const listContent = document.getElementById("list-content");
const importLocalFile = document.getElementById("import-local-file");
const importKind = document.getElementById("import-kind");
const loadFileButton = document.getElementById("load-file-button");
const saveImportButton = document.getElementById("save-import-button");
const saveAllImportButton = document.getElementById("save-all-import-button");
const downloadTimelineTweetsButton = document.getElementById("download-timeline-tweets-button");
const importFileDetail = document.getElementById("import-file-detail");
const serverAccessForm = document.getElementById("server-access-form");
const serverAccessCurrentIp = document.getElementById("server-access-current-ip");
const serverAccessDisabledNote = document.getElementById("server-access-disabled-note");
const scoringForm = document.getElementById("scoring-form");
const generalSettingsForm = document.getElementById("general-settings-form");
const timelineUsersList = document.getElementById("timeline-users-list");
const timelineUserId = document.getElementById("timeline-user-id");
const timelineUserUsername = document.getElementById("timeline-user-username");
const timelineUserPassword = document.getElementById("timeline-user-password");
const timelineUserSave = document.getElementById("timeline-user-save");
const timelineUserClear = document.getElementById("timeline-user-clear");
const timelineUserDelete = document.getElementById("timeline-user-delete");
const timelineUsersStatus = document.getElementById("timeline-users-status");
const staleKeywordUserDays = document.getElementById("stale-keyword-user-days");
const staleKeywordUserStartIndex = document.getElementById("stale-keyword-user-start-index");
const staleKeywordUserSpeedPreset = document.getElementById("stale-keyword-user-speed-preset");
const staleKeywordUserActionDelayMinSeconds = document.getElementById("stale-keyword-user-action-delay-min-seconds");
const staleKeywordUserActionDelayMaxSeconds = document.getElementById("stale-keyword-user-action-delay-max-seconds");
const staleKeywordUserAutoIgnoreAlert = document.getElementById("stale-keyword-user-auto-ignore-alert");
const staleKeywordUserMaxRetries = document.getElementById("stale-keyword-user-max-retries");
const staleKeywordUserAutoRestartDelaySeconds = document.getElementById("stale-keyword-user-auto-restart-delay-seconds");
const searchWithoutApiAutoIgnoreAlert = document.getElementById("search-without-api-auto-ignore-alert");
const searchWithoutApiMaxRetries = document.getElementById("search-without-api-max-retries");
const searchWithoutApiAutoRestartDelaySeconds = document.getElementById("search-without-api-auto-restart-delay-seconds");
const openStaleKeywordUsersButton = document.getElementById("open-stale-keyword-users-button");
const openSkippedKeywordUsersButton = document.getElementById("open-skipped-keyword-users-button");
const toggleInlineStaleKeywordUsersButton = document.getElementById("toggle-inline-stale-keyword-users-button");
const pruneStaleKeywordUsersButton = document.getElementById("prune-stale-keyword-users-button");
const stopStaleKeywordUsersButton = document.getElementById("stop-stale-keyword-users-button");
const resetStaleKeywordUserProgressButton = document.getElementById("reset-stale-keyword-user-progress-button");
const staleKeywordUserPruneResult = document.getElementById("stale-keyword-user-prune-result");
const searchWithoutApiForm = document.getElementById("search-without-api-form");
const searchWithoutApiControls = document.getElementById("search-without-api-controls");
const dockerVpnOnlySettings = Array.from(document.querySelectorAll(".docker-vpn-only"));
const hostNetnsOnlySettings = Array.from(document.querySelectorAll(".host-netns-only"));
const openVpnProfileSelect = document.getElementById("openvpn-profile-select");
const openVpnProfileDetail = document.getElementById("openvpn-profile-detail");
const openVpnSettingsSaveButton = document.getElementById("openvpn-settings-save-button");
const openVpnAuthButton = document.getElementById("openvpn-auth-button");
const openVpnSudoStatusButton = document.getElementById("openvpn-sudo-status-button");
const openVpnSudoDetail = document.getElementById("openvpn-sudo-detail");
const openVpnAuthModal = document.getElementById("openvpn-auth-modal");
const openVpnAuthForm = document.getElementById("openvpn-auth-form");
const openVpnAuthProfile = document.getElementById("openvpn-auth-profile");
const openVpnAuthClose = document.getElementById("openvpn-auth-close");
const openVpnAuthCancel = document.getElementById("openvpn-auth-cancel");
const openVpnShutdownButton = document.getElementById("openvpn-shutdown-button");
const xBrowserAccountSelect = document.getElementById("x-browser-account-select");
const xBrowserIdentifier = document.getElementById("x-browser-identifier");
const xBrowserStorageState = document.getElementById("x-browser-storage-state");
const xBrowserLinkAllProfiles = document.getElementById("x-browser-link-all-profiles");
const xBrowserSessionValidation = document.getElementById("x-browser-session-validation");
const xBrowserAccountDetail = document.getElementById("x-browser-account-detail");
const xBrowserLoginCommand = document.getElementById("x-browser-login-command");
const xBrowserLoginHelp = document.getElementById("x-browser-login-help");
const xBrowserAccountSave = document.getElementById("x-browser-account-save");
const xBrowserAccountDelete = document.getElementById("x-browser-account-delete");
const xBrowserSessionImport = document.getElementById("x-browser-session-import");
const xBrowserSessionExport = document.getElementById("x-browser-session-export");
const xBrowserSessionImportFile = document.getElementById("x-browser-session-import-file");
const xApiForm = document.getElementById("x-api-form");
const xApiControls = document.getElementById("x-api-controls");
const resetXCountersButton = document.getElementById("reset-x-counters-button");
const resetXBudgetButton = document.getElementById("reset-x-budget-button");
const envForm = document.getElementById("env-form");
const sessionPanel = document.getElementById("session-panel");
const sessionLog = document.getElementById("session-log");
const sessionRunStatus = document.getElementById("session-run-status");
const sessionFilePath = document.getElementById("session-file-path");
const sessionUpdatedAt = document.getElementById("session-updated-at");
const sessionCurrentKeyword = document.getElementById("session-current-keyword");
const sessionKeywordProgress = document.getElementById("session-keyword-progress");
const sessionStalePruneStatus = document.getElementById("session-stale-prune-status");
const sessionApiLeftLabel = document.getElementById("session-api-left-label");
const sessionApiLeft = document.getElementById("session-api-left");
const sessionAcceptedTweets = document.getElementById("session-accepted-tweets");
const sessionNextResetLabel = document.getElementById("session-next-reset-label");
const sessionNextReset = document.getElementById("session-next-reset");
const sessionAutoRefresh = document.getElementById("session-auto-refresh");
const sessionStickBottom = document.getElementById("session-stick-bottom");
const sessionRefreshButton = document.getElementById("session-refresh-button");
const sessionFullscreenButton = document.getElementById("session-fullscreen-button");
const sessionKeywordsSummary = document.getElementById("session-keywords-summary");
const sessionKeywordsList = document.getElementById("session-keywords-list");
const sessionKeywordsRefreshButton = document.getElementById("session-keywords-refresh-button");
const sessionLevelOptions = Array.from(document.querySelectorAll("[data-session-level]"));
const sessionIncludeAdminPolling = document.getElementById("session-include-admin-polling");
const sessionTweetContent = document.getElementById("session-tweet-content");
const sessionTweetScore = document.getElementById("session-tweet-score");
const sessionTweetFavorites = document.getElementById("session-tweet-favorites");
const sessionTweetRetweets = document.getElementById("session-tweet-retweets");
const adminTestOutput = document.getElementById("admin-test-output");
const adminTestButtons = Array.from(document.querySelectorAll("[data-admin-test]"));
const browserSnapshotsRefreshButton = document.getElementById("browser-snapshots-refresh-button");
const browserSnapshotsCount = document.getElementById("browser-snapshots-count");
const browserSnapshotsList = document.getElementById("browser-snapshots-list");
const browserSnapshotMeta = document.getElementById("browser-snapshot-meta");
const browserSnapshotFullText = document.getElementById("browser-snapshot-full-text");
const databaseSummary = document.getElementById("database-summary");
const databaseTables = document.getElementById("database-tables");
const databaseTableCount = document.getElementById("database-table-count");
const databaseTableTitle = document.getElementById("database-table-title");
const databaseTableSummary = document.getElementById("database-table-summary");
const databaseSchema = document.getElementById("database-schema");
const databaseColumns = document.getElementById("database-columns");
const databaseIndexes = document.getElementById("database-indexes");
const databaseForeignKeys = document.getElementById("database-foreign-keys");
const databasePreview = document.getElementById("database-preview");
const databaseRefreshButton = document.getElementById("database-refresh-button");
const databaseIntegrityButton = document.getElementById("database-integrity-button");
const databaseAnalyzeButton = document.getElementById("database-analyze-button");
const databaseVacuumButton = document.getElementById("database-vacuum-button");
const databaseDownloadJsonButton = document.getElementById("database-download-json-button");
const databaseDownloadCsvButton = document.getElementById("database-download-csv-button");
const databaseClearTableButton = document.getElementById("database-clear-table-button");
const pathPickerModal = document.getElementById("path-picker-modal");
const pathPickerTitle = document.getElementById("path-picker-title");
const pathPickerCurrent = document.getElementById("path-picker-current");
const pathPickerRoots = document.getElementById("path-picker-roots");
const pathPickerEntries = document.getElementById("path-picker-entries");
const pathPickerClose = document.getElementById("path-picker-close");
const pathPickerParent = document.getElementById("path-picker-parent");
const pathPickerUseCurrent = document.getElementById("path-picker-use-current");

const listState = {
  kind: editKind.value,
  offset: 0,
  limit: 80,
  hasMore: true,
  loading: false,
  search: "",
  total: null,
  pendingEntryId: null,
  selectedEntry: null
};

const databaseState = {
  tables: [],
  selectedTable: null
};

let pendingImports = [];
let sessionRefreshTimer = null;
let openXSessionAlerts = [];
let recentXSessionAlerts = [];
let selectedXSessionAlertId = null;
let currentRuntimeModes = {};
let currentSessionStats = null;
let listSearchTimer = null;
let pathPickerState = { input: null, mode: "file", cwd: "", parent: null };
let openVpnProfiles = [];
let openVpnAuthProfilePath = "";
let xBrowserAccounts = [];
let timelineUsers = [];
let latestListCounts = {};
let browserSnapshotRuns = [];
let selectedBrowserSnapshot = null;
let sessionShouldStickBottom = true;
let sessionNextResetAt = null;
let sessionNextResetTimer = null;
let statusLineTimer = null;
let staleKeywordUserPrunePollTimer = null;
let staleKeywordUserPruneCountdownTimer = null;
let currentStaleKeywordUserPruneStatus = null;
let staleKeywordUserStartIndexTouched = false;
let staleKeywordUserInlineListVisible = false;
let staleKeywordUserInlineListTouched = false;
let alertSnapshotHeightPx = 360;
const buttonFeedbackTimers = new WeakMap();
const manualLoginPollTimers = new Map();
const moreNavSectionIds = new Set(["tests", "database", "env", "system"]);

const editableKinds = new Set(Array.from(editKind.options).map((option) => option.value));
const openVpnSettingsFields = [
  "VPN_NETNS_NAME",
  "VPN_HOST_IFACE",
  "VPN_NETNS_CIDR",
  "VPN_NETNS_HOST_IP",
  "VPN_NETNS_GUEST_IP",
  "VPN_CONFIG",
  "VPN_REMOTE_HOST",
  "VPN_REMOTE_PORT",
  "VPN_REMOTE_PROTO"
];
const legacyKindByFilename = new Map([
  ["Rq.Keywords", "keyword"],
  ["Rq.Following", "following"],
  ["Rq.Friends", "friend"],
  ["Rq.Bannedpeople", "banned_user"],
  ["Rq.Bannedword", "banned_word"],
  ["Rq.Bannedword.Exception", "banned_word_exception"],
  ["Rq.Rss", "rss_feed"],
  ["RssSave", "rss_sent"],
  ["Tweets.Sent", "tweet_sent"],
  ["Text.Sent", "text_sent"],
  ["No.Result", "no_result"],
  ["Suggested.Keywords", "suggested_keyword"],
  ["suggested_keyword.txt", "suggested_keyword"],
  ["Request.log", "request_log"],
  ["TotalApi.Call", "total_api_call"],
  ["UpdateStatus.Call", "update_status_call"],
  ["Current.Session", "current_session"],
  ["SearchTerms.Used", "search_terms_used"],
  ["Stale.Keyword.Users", "stale_keyword_user"],
  ["Skipped.Keyword.Users", "skipped_keyword_user"],
  ["stale_keyword_user.txt", "stale_keyword_user"],
  ["skipped_keyword_user.txt", "skipped_keyword_user"],
  ["Timeline.Tweets.jsonl", "timeline_tweets"],
  ["timeline_tweets.jsonl", "timeline_tweets"],
  [".Session", "hidden_session"]
]);

const metricDefinitions = [
  ["keyword", "Rq.Keywords"],
  ["following", "Rq.Following"],
  ["friend", "Rq.Friends"],
  ["banned_user", "Rq.Bannedpeople"],
  ["banned_word", "Rq.Bannedword"],
  ["rss_feed", "RSS feeds"],
  ["rss_sent", "RssSave"],
  ["no_result", "No.Result"],
  ["suggested_keyword", "Suggested keywords"],
  ["search_terms_used", "SearchTerms.Used"],
  ["stale_keyword_user", "Stale keyword users"],
  ["skipped_keyword_user", "Skipped keyword users"],
  ["tweet_sent", "Tweets.Sent"],
  ["update_status_call", "UpdateStatus.Call"],
  ["text_sent", "Text.Sent"],
  ["total_api_call", "TotalApi.Call"],
  ["current_session", "Current.Session entries"]
];

const xApiOnlyCounterKinds = new Set(["total_api_call", "update_status_call"]);

const scoringNumberFields = [
  "minimumSearchResults",
  "luckFactorDenominator",
  "minimumTweetLength",
  "minimumTweetRetweets",
  "maximumTweetRetweets",
  "minimumTweetFavorites",
  "maximumTweetFavorites",
  "minimumUserFollowers",
  "minimumTweetScore",
  "maximumTweetAgeDays",
  "maximumHashtags",
  "maximumMentions",
  "maximumTweetsByUser",
  "similarTweetTextThreshold"
];

const scoringBooleanFields = [
  "enableMinimumSearchResults",
  "enableLuckFactor",
  "enableAllowedLanguages",
  "enableMinimumTweetLength",
  "enableMinimumTweetRetweets",
  "enableMaximumTweetRetweets",
  "enableMinimumTweetFavorites",
  "enableMaximumTweetFavorites",
  "relaxMinimumPopularityForHandleSearch",
  "enableMinimumUserFollowers",
  "enableMinimumTweetScore",
  "enableMaximumTweetAgeDays",
  "enableMaximumHashtags",
  "enableMaximumMentions",
  "enableMaximumTweetsByUser",
  "enableSimilarTweetText"
];

const scoringCheckTargets = {
  enableMinimumSearchResults: "minimumSearchResults",
  enableLuckFactor: "luckFactorDenominator",
  enableAllowedLanguages: "allowedLanguages",
  enableMinimumTweetLength: "minimumTweetLength",
  enableMinimumTweetRetweets: "minimumTweetRetweets",
  enableMaximumTweetRetweets: "maximumTweetRetweets",
  enableMinimumTweetFavorites: "minimumTweetFavorites",
  enableMaximumTweetFavorites: "maximumTweetFavorites",
  enableMinimumUserFollowers: "minimumUserFollowers",
  enableMinimumTweetScore: "minimumTweetScore",
  enableMaximumTweetAgeDays: "maximumTweetAgeDays",
  enableMaximumHashtags: "maximumHashtags",
  enableMaximumMentions: "maximumMentions",
  enableMaximumTweetsByUser: "maximumTweetsByUser",
  enableSimilarTweetText: "similarTweetTextThreshold"
};

const serverAccessFields = ["whitelist", "blacklist"];

const generalSettingsFields = [
  "TIMELINE_DEFAULT_PAGE_SIZE",
  "RAW_TIMELINE_ENABLED",
  "RUN_CHAIN_COUNT",
  "STALE_KEYWORD_USER_MAX_AGE_DAYS",
  "STALE_KEYWORD_USER_START_INDEX",
  "STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS",
  "STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS",
  "STALE_KEYWORD_USER_AUTO_IGNORE_ALERT",
  "STALE_KEYWORD_USER_MAX_RETRIES",
  "STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS",
  "SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT",
  "SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM",
  "SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER",
  "SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT",
  "SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT",
  "SEARCH_WITHOUT_API_MAX_RETRIES",
  "SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS",
  "SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN",
  "SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES",
  "SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES",
  "SEARCH_WITHOUT_API_MAX_SCROLLS",
  "SEARCH_WITHOUT_API_SCROLL_DELAY_MS",
  "SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS",
  "SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS",
  "SEARCH_WITHOUT_API_SCROLLS_MIN",
  "SEARCH_WITHOUT_API_SCROLLS_MAX",
  "REDDIT_CRAWL_ENABLED",
  "REDDIT_CRAWL_USER_AGENT",
  "REDDIT_CRAWL_SUBREDDITS",
  "REDDIT_CRAWL_LIMIT_PER_KEYWORD",
  "REDDIT_CRAWL_SORT",
  "REDDIT_CRAWL_TIME_RANGE",
  "REDDIT_CRAWL_MIN_SCORE"
];

const xApiFields = [
  "X_API_ENABLED",
  "X_API_CREDIT_USD",
  "X_API_TOTAL_CREDIT_USED_USD",
  "X_DAILY_SPEND_LIMIT_USD",
  "X_RUN_SPEND_LIMIT_USD",
  "X_MAX_SEARCHES_PER_DAY",
  "X_MAX_POSTS_READ_PER_DAY",
  "X_MAX_COUNT_CALLS_PER_DAY",
  "X_KEYWORDS_PER_QUERY",
  "X_COUNT_FIRST_MODE",
  "X_SEARCH_API_CALL_LIMIT",
  "X_SEARCH_API_WINDOW_MINUTES",
  "X_COST_POST_READ_USD",
  "X_COST_USER_READ_USD",
  "X_COST_MEDIA_READ_USD",
  "X_COST_USER_INTERACTION_USD",
  "X_COST_COUNT_CALL_USD"
];

const searchWithoutApiFields = [
  "SEARCH_WITHOUT_API_ENABLED",
  "SEARCH_WITHOUT_API_ISOLATION",
  "SEARCH_WITHOUT_API_PROFILE_DIR",
  "SEARCH_WITHOUT_API_START_URL",
  "SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL",
  "SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS",
  "SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS",
  "SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS",
  "SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS",
  "SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS",
  "SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS",
  "SEARCH_WITHOUT_API_MOUSE_PROFILE",
  "SEARCH_WITHOUT_API_SAVE_SNAPSHOTS",
  "SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED",
  "SEARCH_WITHOUT_API_MEDIA_CACHE_DIR",
  "SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS",
  "SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB",
  "SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB",
  "SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS",
  "SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS",
  "X_LOGIN_NOVNC_PORT",
  "X_LOGIN_SCREEN",
  "X_LOGIN_SERVICE_MAX_SECONDS",
  "X_LOGIN_BROWSER",
  "X_LOGIN_SAVE_MODE",
  "X_LOGIN_REUSE_BROWSER_PROFILE",
  "X_LOGIN_START_URL",
  "VPN_NETNS_NAME",
  "VPN_HOST_IFACE",
  "VPN_NETNS_CIDR",
  "VPN_NETNS_HOST_IP",
  "VPN_NETNS_GUEST_IP",
  "VPN_REMOTE_HOST",
  "VPN_REMOTE_PORT",
  "VPN_REMOTE_PROTO",
  "VPN_CONFIG",
  "VPN_CHECK_HOST_IPV4_LEAK",
  "VPN_CHECK_IPV6",
  "VPN_DIAGNOSTIC_STRICT",
  "VPN_DIAGNOSTIC_PLAYWRIGHT",
  "X_LOGIN_SKIP_NETWORK_PRECHECK",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  "PLAYWRIGHT_DISABLE_SANDBOX"
];

const envFields = [
  "ADMIN_HOST",
  "ADMIN_PORT",
  "ADMIN_TRUST_PROXY",
  "ADMIN_AUTH_MODE",
  "ADMIN_MTLS_PROXY_SECRET",
  "ADMIN_PUBLIC_URL",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "ADMIN_PASSWORD_HASH",
  "SESSION_SECRET",
  "DATABASE_URL",
  "CURRENT_SESSION_FILE",
  "ADMIN_IPV4_WHITELIST",
  "ADMIN_IPV4_BLACKLIST",
  "RSS_FALLBACK_FEED_LIMIT",
  "REDDIT_CRAWL_ENABLED",
  "REDDIT_CRAWL_USER_AGENT",
  "REDDIT_CRAWL_SUBREDDITS",
  "REDDIT_CRAWL_LIMIT_PER_KEYWORD",
  "REDDIT_CRAWL_SORT",
  "REDDIT_CRAWL_TIME_RANGE",
  "REDDIT_CRAWL_MIN_SCORE",
  "X_BEARER_TOKEN",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "ENABLE_X_WRITE",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET"
];

const eyeIcon = `
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
`;

const eyeOffIcon = `
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M10.73 5.08a10.74 10.74 0 0 1 11.21 6.57 1 1 0 0 1 0 .7 10.76 10.76 0 0 1-1.44 2.49" />
    <path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" />
    <path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14" />
    <path d="m2 2 20 20" />
  </svg>
`;

const staleKeywordUserSpeedPresets = {
  very_slow: { min: 5, max: 10, label: "Very slow" },
  slow: { min: 3, max: 6, label: "Slow" },
  normal: { min: 1, max: 5, label: "Normal" },
  fast: { min: 1, max: 2, label: "Fast" },
  very_fast: { min: 0, max: 0, label: "No pause" }
};

const adminTooltipByName = {
  kind: "Choose which admin list you want to edit.",
  value: "Type the raw value to add or update in the selected list.",
  ADMIN_IPV4_WHITELIST:
    "Extra IPv4 addresses or CIDR ranges always allowed by the HTTP access policy after the server restarts. Comma, space, semicolon, or newline separators are accepted.",
  ADMIN_IPV4_BLACKLIST:
    "Extra IPv4 addresses or CIDR ranges always blocked by the HTTP access policy after the server restarts. Blacklist entries win over whitelist entries.",
  ADMIN_TRUST_PROXY:
    "Enable only when RedqueenX is behind a trusted local reverse proxy such as Caddy, so the whitelist uses the real client IP from X-Forwarded-For.",
  ADMIN_AUTH_MODE:
    "password keeps the local admin login page. mtls_proxy trusts a local reverse proxy that already required a valid client certificate.",
  ADMIN_MTLS_PROXY_SECRET: "Shared secret expected from the trusted mTLS reverse proxy before RedqueenX accepts certificate-mode admin requests.",
  ADMIN_PUBLIC_URL: "External admin URL used by public timeline navigation, for example https://admin.example.com.",
  allowedLanguages: "Comma-separated language codes accepted by the tweet scoring rules.",
  enableAllowedLanguages: "Enable or disable the allowed-language rejection check.",
  minimumSearchResults: "Minimum number of search results required before the keyword is considered useful.",
  enableMinimumSearchResults: "Enable or disable saving a keyword as No.Result when too few usable tweets are found.",
  luckFactorDenominator: "Random acceptance chance for a rejected tweet. 200 means one chance out of 200.",
  enableLuckFactor: "Enable or disable the random luck-factor acceptance bypass.",
  minimumTweetLength: "Reject tweets shorter than this number of characters.",
  enableMinimumTweetLength: "Enable or disable the minimum tweet length rejection check.",
  minimumTweetRetweets: "Minimum retweet count required by the scoring rules.",
  enableMinimumTweetRetweets: "Enable or disable the minimum retweet rejection check.",
  maximumTweetRetweets: "Reject tweets above this retweet count.",
  enableMaximumTweetRetweets: "Enable or disable the maximum retweet rejection check.",
  minimumTweetFavorites: "Minimum favorite count required by the scoring rules.",
  enableMinimumTweetFavorites: "Enable or disable the minimum favorite rejection check.",
  maximumTweetFavorites: "Reject tweets above this favorite count.",
  enableMaximumTweetFavorites: "Enable or disable the maximum favorite rejection check.",
  relaxMinimumPopularityForHandleSearch:
    "Use 50% of the configured minimum retweet and favorite thresholds for @user searches, rounded up.",
  minimumUserFollowers: "Minimum author follower count required by the scoring rules.",
  enableMinimumUserFollowers: "Enable or disable the minimum follower rejection check.",
  minimumTweetScore: "Minimum final score required before a tweet is accepted.",
  enableMinimumTweetScore: "Enable or disable the final minimum score rejection check.",
  maximumTweetAgeDays: "Reject tweets older than this number of days.",
  enableMaximumTweetAgeDays: "Enable or disable the maximum tweet age rejection check.",
  maximumHashtags: "Reject tweets with this many hashtags or more.",
  enableMaximumHashtags: "Enable or disable the maximum hashtag rejection check.",
  maximumMentions: "Reject tweets with this many mentions or more.",
  enableMaximumMentions: "Enable or disable the maximum mention rejection check.",
  maximumTweetsByUser: "Maximum accepted tweets allowed from the same author in one scoring window.",
  enableMaximumTweetsByUser: "Enable or disable the per-author tweet limit rejection check.",
  similarTweetTextThreshold: "Reject a tweet when its token similarity with an already accepted tweet reaches this value. Default 0.52 catches close paraphrases.",
  enableSimilarTweetText: "Enable or disable near-duplicate tweet text rejection.",
  whitelist: "IPv4 addresses or CIDR ranges allowed to access RedqueenX over HTTPS. Your current IP is kept allowed automatically unless blacklisted.",
  blacklist: "IPv4 addresses or CIDR ranges denied access to RedqueenX over HTTPS. Blacklist wins over whitelist.",
  SEARCH_WITHOUT_API_ENABLED: "Enable the future non-API search mode and stop X API search.",
  SEARCH_WITHOUT_API_ISOLATION:
    "host_netns keeps the existing Linux namespace helper flow. docker_vpn assigns runs to the Docker VPN worker and forbids admin netns script launches.",
  X_LOGIN_SKIP_NETWORK_PRECHECK: "Skip the X login API/CORS precheck before opening Chrome. Keep false unless manually troubleshooting a blocked login flow.",
  SEARCH_WITHOUT_API_PROFILE_DIR: "Local browser profile directory reserved for the future browser-based search mode.",
  SEARCH_WITHOUT_API_START_URL: "Starting URL reserved for the future browser-based search mode.",
  SEARCH_WITHOUT_API_MAX_SCROLLS: "Legacy placeholder for maximum browser result scrolls.",
  SEARCH_WITHOUT_API_SCROLL_DELAY_MS: "Legacy placeholder for delay between browser scrolls.",
  SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS: "Minimum random pause after each Playwright result scroll. Default is 5000 ms.",
  SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS: "Maximum random pause after each Playwright result scroll.",
  SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL:
    "When enabled on a local desktop with Wayland or X11, RedqueenX shows the Playwright browser window. When disabled, browser search runs headless.",
  SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS: "Minimum random delay before each typed character.",
  SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS: "Maximum random delay before each typed character.",
  SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS: "Minimum random delay between two searches.",
  SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS: "Maximum random delay between two searches.",
  SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT:
    "Maximum number of keywords searched in one session, for X API and without-API modes. Use 0 to search every eligible keyword.",
  SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM:
    "When true, each session randomly chooses a keyword count between 1 and the configured session limit.",
  SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER:
    "Shuffle eligible keywords before applying the session limit so each run does not always start with the same entries.",
  SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT:
    "Target percentage of @user keywords in each session. The planner adapts when one keyword type runs out, so runs do not stop just because the ratio cannot be met exactly.",
  REDDIT_CRAWL_ENABLED: "Search Reddit for normal, non-@user keywords after each X keyword search.",
  REDDIT_CRAWL_USER_AGENT: "User-Agent sent to Reddit's public JSON endpoint.",
  REDDIT_CRAWL_SUBREDDITS: "Comma-separated subreddits to search. Leave empty to search all Reddit.",
  REDDIT_CRAWL_LIMIT_PER_KEYWORD: "Maximum Reddit posts saved for one keyword.",
  REDDIT_CRAWL_SORT: "Reddit search sort mode.",
  REDDIT_CRAWL_TIME_RANGE: "Reddit search time range used with the configured sort mode.",
  REDDIT_CRAWL_MIN_SCORE: "Minimum Reddit post score required before saving the post to Timeline.",
  SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT:
    "When Search without Api is stopped by an X session alert, mark that alert ignored automatically and resume the same run.",
  SEARCH_WITHOUT_API_MAX_RETRIES:
    "Maximum restart attempts after X session alerts during Search without Api. Used only when Ignore alerts is enabled.",
  SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS:
    "Seconds to wait after an X session alert is auto-ignored before resuming Search without Api.",
  SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN:
    "Number of keyword searches required before a pacing pause. The runtime will not pause earlier unless the session has no keywords left.",
  SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES: "Minimum random pause duration after the search limit is reached.",
  SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES: "Maximum random pause duration after the search limit is reached.",
  SEARCH_WITHOUT_API_SCROLLS_MIN: "Minimum random number of result-page scrolls per search.",
  SEARCH_WITHOUT_API_SCROLLS_MAX: "Maximum random number of result-page scrolls per search.",
  SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS: "Minimum random time to keep focus on an individual tweet.",
  SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS: "Maximum random time to keep focus on an individual tweet.",
  SEARCH_WITHOUT_API_MOUSE_PROFILE: "Select the future mouse movement curve preset.",
  SEARCH_WITHOUT_API_SAVE_SNAPSHOTS:
    "Save full Playwright page text snapshots during normal browser runs. Smoke tests always save snapshots.",
  SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED:
    "Allow the VPN namespace worker to download X media into the local cache. Keep false if you never want RedqueenX to request X media files.",
  SEARCH_WITHOUT_API_MEDIA_CACHE_DIR: "Directory where VPN-downloaded media files are stored temporarily.",
  SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS:
    "How long cached media remains usable before the timeline asks for a VPN reload. Use 0 to keep cached media indefinitely.",
  SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB:
    "Maximum total cache size. Oldest cached files are removed when this limit is exceeded. Use 0 for unlimited total size.",
  SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB: "Maximum size accepted for a single downloaded image or video.",
  SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS: "Minimum delay between two media downloads in the VPN worker.",
  SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS: "Maximum delay between two media downloads in the VPN worker.",
  X_LOGIN_NOVNC_PORT: "Host/container port used by the Docker noVNC login page. Bound to 127.0.0.1 by Compose.",
  X_LOGIN_SCREEN: "Virtual screen size used by Docker x-login, for example 1920x1080x24.",
  X_LOGIN_SERVICE_MAX_SECONDS: "Maximum lifetime of one Docker x-login/noVNC container. The service exits automatically when it reaches this limit.",
  X_LOGIN_BROWSER:
    "Browser used by Docker noVNC manual login. Firefox auto-saves when X Home is loaded and avoids the Chrome onboarding 400/code 399 loop.",
  X_LOGIN_SAVE_MODE:
    "How x-login saves the browser session. Auto uses profile extraction in Docker noVNC and live CDP capture in host namespace.",
  X_LOGIN_REUSE_BROWSER_PROFILE:
    "Reuse the previous Docker browser profile during manual x-login. Keep false to avoid reusing a partial/broken X login flow.",
  X_LOGIN_START_URL: "Initial X login page opened by the manual browser helper.",
  TIMELINE_DEFAULT_PAGE_SIZE: "Default number of tweets shown per page on Timeline and Rejected Timeline when the URL has no limit parameter.",
  RUN_CHAIN_COUNT:
    "Keyword batch multiplier for the next single run. 0 means one normal batch; 1 doubles the planned keyword count; 3 searches three batches.",
  STALE_KEYWORD_USER_MAX_AGE_DAYS:
    "Saved default threshold for Keyword users cleanup. @keywords are removed when the latest visible tweet is older than this many days.",
  STALE_KEYWORD_USER_START_INDEX:
    "Saved 1-based active keyword user index used when starting Keyword users cleanup.",
  STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS:
    "Minimum random pause in seconds between the actions of Keyword users cleanup.",
  STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS:
    "Maximum random pause in seconds between the actions of Keyword users cleanup.",
  STALE_KEYWORD_USER_AUTO_IGNORE_ALERT:
    "When Keyword users cleanup is stopped by an X session alert, mark that alert ignored automatically and retry the cleanup once.",
  STALE_KEYWORD_USER_MAX_RETRIES:
    "Maximum number of times Keyword users cleanup can restart after an X session alert. The control is active only when Ignore alerts is enabled.",
  STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS:
    "Seconds to wait after an X session alert is auto-ignored before restarting Keyword users cleanup.",
  RAW_TIMELINE_ENABLED: "Enable rejected timeline capture and the Rejected Timeline page. Disable it to stop saving every DOM-visible tweet.",
  VPN_NETNS_NAME: "Linux network namespace name used by the browser crawler.",
  VPN_HOST_IFACE: "Host network interface used before OpenVPN connects. Leave empty for auto-detection.",
  VPN_NETNS_CIDR: "Private IPv4 subnet used between the host and the namespace.",
  VPN_NETNS_HOST_IP: "Host-side veth IPv4 address for the namespace bridge.",
  VPN_NETNS_GUEST_IP: "Namespace-side veth IPv4 address for the browser crawler.",
  VPN_REMOTE_HOST: "OpenVPN server hostname or IPv4 address. The script resolves hostnames before applying the kill switch.",
  VPN_REMOTE_PORT: "OpenVPN server port allowed through the namespace kill switch.",
  VPN_REMOTE_PROTO: "OpenVPN transport protocol allowed through the namespace kill switch.",
  VPN_CONFIG: "Path to the local OpenVPN client configuration file. The file picker only shows .ovpn profiles.",
  VPN_CHECK_HOST_IPV4_LEAK: "Compare browser/namespace public IPv4 with the host public IPv4 detected before entering the namespace.",
  VPN_CHECK_IPV6: "Run IPv6 leak checks. Keep true to detect IPv6 leaks by default.",
  VPN_DIAGNOSTIC_STRICT: "Fail diagnostics when required network checks cannot be verified.",
  VPN_DIAGNOSTIC_PLAYWRIGHT: "Run browser-level VPN diagnostics through Playwright.",
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "Optional path to system Chromium used by Playwright.",
  PLAYWRIGHT_DISABLE_SANDBOX: "Launch Chromium with --no-sandbox when true. Keep false in Docker unless Chromium reports that no sandbox is usable.",
  X_API_ENABLED: "Enable or disable X API search. Disabling it stops any active X API run.",
  X_API_CREDIT_USD: "Remaining account credit available for X API usage.",
  X_API_TOTAL_CREDIT_USED_USD: "Total X credit already consumed outside this local cost estimate.",
  X_DAILY_SPEND_LIMIT_USD: "Maximum estimated X API spend allowed per day. Zero means no local spend allowance.",
  X_RUN_SPEND_LIMIT_USD: "Maximum estimated X API spend allowed for one run.",
  X_MAX_SEARCHES_PER_DAY: "Maximum X search requests allowed per day. Zero blocks search requests.",
  X_MAX_POSTS_READ_PER_DAY: "Maximum X posts allowed to be read per day. Zero blocks post reads.",
  X_MAX_COUNT_CALLS_PER_DAY: "Maximum count-first calls allowed per day.",
  X_KEYWORDS_PER_QUERY: "How many keywords are grouped into one X query.",
  X_COUNT_FIRST_MODE: "Run a cheap count query before reading tweets.",
  X_SEARCH_API_CALL_LIMIT: "Maximum search calls before the API window pause logic is triggered.",
  X_SEARCH_API_WINDOW_MINUTES: "Length of the X API window in minutes.",
  X_COST_POST_READ_USD: "Local estimated cost for reading one X post.",
  X_COST_USER_READ_USD: "Local estimated cost for reading one X user.",
  X_COST_MEDIA_READ_USD: "Local estimated cost for reading media metadata.",
  X_COST_USER_INTERACTION_USD: "Local estimated cost for a manual like or retweet action.",
  X_COST_COUNT_CALL_USD: "Local estimated cost for one count-first call.",
  ADMIN_HOST: "Network address used by the admin HTTP server.",
  ADMIN_PORT: "Port used by the admin HTTP server.",
  ADMIN_PASSWORD: "Password required to access the admin interface.",
  SESSION_SECRET: "Secret used to sign JWT cookies for admin and timeline sessions.",
  DATABASE_URL: "SQLite database file used by the TypeScript service.",
  CURRENT_SESSION_FILE: "Path to the live session log file.",
  RSS_FALLBACK_FEED_LIMIT: "Maximum number of RSS feeds used by legacy fallback logic.",
  X_BEARER_TOKEN: "Bearer token used for X API read/search requests.",
  X_API_KEY: "X API consumer key, also called API key.",
  X_API_SECRET: "X API consumer secret.",
  X_ACCESS_TOKEN: "X OAuth 1.0a access token for write actions.",
  X_ACCESS_SECRET: "X OAuth 1.0a access token secret for write actions.",
  ENABLE_X_WRITE: "Enable X write actions such as like and retweet.",
  X_CLIENT_ID: "X OAuth 2.0 client ID placeholder.",
  X_CLIENT_SECRET: "X OAuth 2.0 client secret placeholder."
};

const adminTooltipById = {
  "edit-kind": "Choose which list is loaded in the editor and active content panel.",
  "entry-value": "Edit the selected value or type a new value to add.",
  "list-search": "Filter the active list without changing stored data.",
  "import-local-file": "Choose one or more legacy files from this computer.",
  "import-kind": "Select how the chosen file should be interpreted before saving it to SQLite.",
  "load-file-button": "Load selected local files into the import preview without saving them yet.",
  "save-import-button": "Save the currently loaded import preview into SQLite.",
  "save-all-import-button": "Import selected files and save them into SQLite in one action.",
  "download-timeline-tweets-button": "Download every accepted timeline tweet as a JSON Lines file that can be imported back later.",
  "save-selected-button": "Save changes to the selected list entry.",
  "download-list-button": "Download the currently selected list as a local file.",
  "delete-selected-button": "Delete the selected list entry from active use.",
  "clear-selection-button": "Clear the selected row and return to add mode.",
  "delete-all-list-button": "Delete every active entry in the currently selected list after confirmation.",
  "cleanup-lists-button":
    "Clean editable lists: remove duplicates, empty rows, keywords blocked by bans, and stale/skipped user conflicts.",
  "stale-keyword-user-days": "Remove @keywords when the latest visible tweet from that user is older than this many days.",
  "stale-keyword-user-start-index": "Start checking @keywords at this 1-based position in the planned user list. Use the estimated value after an interrupted cleanup.",
  "stale-keyword-user-speed-preset":
    "Choose a predefined execution speed profile for Keyword users cleanup. It controls the random pause between actions and updates a running cleanup immediately.",
  "stale-keyword-user-action-delay-min-seconds": "Minimum random pause in seconds between user-search actions during Keyword users cleanup.",
  "stale-keyword-user-action-delay-max-seconds": "Maximum random pause in seconds between user-search actions during Keyword users cleanup.",
  "stale-keyword-user-max-retries": "Maximum restart attempts after X session alerts during Keyword users cleanup. Used only in browser-session mode.",
  "stale-keyword-user-auto-restart-delay-seconds":
    "Seconds to wait after auto-ignoring an X session alert before restarting Keyword users cleanup.",
  "open-stale-keyword-users-button": "Open the list of @keywords removed by stale user cleanup.",
  "toggle-inline-stale-keyword-users-button": "Show or hide the stale keyword users preview in this section.",
  "open-skipped-keyword-users-button": "Open the list of @keywords skipped by stale user cleanup, with the recorded reason.",
  "prune-stale-keyword-users-button": "Start inactive users check: stop the active run, check @keywords through the active search mode, and move inactive users to Stale keyword users.",
  "stop-stale-keyword-users-button": "Stop the active inactive users check and keep the progress already written to the report.",
  "reset-stale-keyword-user-progress-button":
    "Clear saved inactive users check progress and reset Start from index to 1. Stale and skipped user lists are not deleted.",
  "reset-x-counters-button": "Reset local X request counters without clearing estimated spend.",
  "reset-x-budget-button": "Reset today's local X budget usage.",
  "openvpn-profile-select": "Select one imported OpenVPN profile. The config path, remote host, port, and protocol are filled from that profile.",
  "openvpn-sudo-status-button": "Check if the root-owned RedqueenX helper is installed. RedqueenX never asks for or stores your sudo password in the web app.",
  "openvpn-settings-save-button": "Save only the Linux namespace/OpenVPN fields and apply the OpenVPN restart/stop logic immediately.",
  "openvpn-auth-button": "Create or replace the .auth file associated with the selected OpenVPN profile.",
  "openvpn-shutdown-button": "Stop any active RedqueenX run, close commands running inside the VPN namespace, then stop OpenVPN so the kill switch/teardown prevents host IP leakage.",
  "openvpn-auth-close": "Close the OpenVPN auth dialog without saving.",
  "openvpn-auth-cancel": "Close the OpenVPN auth dialog without saving.",
  "x-browser-account-select": "Select an existing browser-session account linked to an OpenVPN profile.",
  "x-browser-identifier": "Human-readable X account identifier. This can be the handle, for example @redqueenx_example.",
  "x-browser-link-all-profiles": "Attach every imported OpenVPN profile to this X browser account instead of only the selected profile.",
  "x-browser-storage-state": "Sensitive Playwright storageState file path. RedqueenX never displays the file content.",
  "x-browser-session-validation": "Shows whether RedqueenX can see a saved Playwright browser session for this X account.",
  "x-browser-account-save": "Save or update the link between OpenVPN profiles and this X account.",
  "x-browser-account-delete": "Delete only the database link. The sensitive storageState file is left on disk until removed manually.",
  "x-browser-session-import": "Import a Playwright storageState JSON file for the selected X browser account. This overwrites the saved session file.",
  "x-browser-session-export": "Download the selected X browser account storageState JSON file.",
  "x-browser-session-import-file": "Choose the Playwright storageState JSON file to import for the selected X browser account.",
  "session-auto-refresh": "Refresh this session view automatically every few seconds.",
  "session-include-admin-polling": "Show or hide admin polling requests in the session log.",
  "session-tweet-content": "Include tweet text in session log output.",
  "session-tweet-score": "Include tweet score information in session log output.",
  "session-tweet-favorites": "Include tweet favorite counts in session log output.",
  "session-tweet-retweets": "Include tweet retweet counts in session log output.",
  "session-refresh-button": "Refresh the current session log now.",
  "database-refresh-button": "Reload SQLite database size, table list, and selected table details.",
  "database-integrity-button": "Run PRAGMA integrity_check on the SQLite database.",
  "database-analyze-button": "Run SQLite ANALYZE to refresh query planner statistics.",
  "database-vacuum-button": "Run SQLite VACUUM to compact the database file.",
  "database-download-json-button": "Download the selected table as JSON.",
  "database-download-csv-button": "Download the selected table as CSV.",
  "database-clear-table-button": "Empty the selected SQLite table after exact typed confirmation."
};

const adminTooltipBySection = {
  lists: "Open list editing for keywords, users, bans, RSS feeds, and No.Result.",
  counters: "Open runtime counters and local budget counters.",
  session: "Open live session logs and current run details.",
  import: "Open legacy file import tools.",
  settings: "Open scoring, search mode, and API settings.",
  database: "Open SQLite database management tools.",
  env: "Open .env editing tools."
};

const adminTooltipByRunAction = {
  start: "Start a new run using the currently active search mode.",
  pause: "Pause the current run without clearing its progress.",
  resume: "Resume the paused run.",
  stop: "Stop the current run and clear active execution."
};

function cookieValue(name) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function csrfToken() {
  const value = cookieValue("redqueen_csrf");
  return value ? decodeURIComponent(value) : "";
}

function isMutationMethod(method) {
  return ["DELETE", "PATCH", "POST", "PUT"].includes(String(method || "GET").toUpperCase());
}

async function jsonFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const hasBody = options.body !== undefined;
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (hasBody && !hasContentType && !(options.body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }
  if (isMutationMethod(options.method)) {
    const token = csrfToken();
    if (token) {
      headers["x-redqueenx-csrf"] = token;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    location.href = "/admin/login";
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    let payload = null;
    try {
      payload = JSON.parse(text);
      message = payload.error || payload.message || text;
    } catch {
      // Keep the raw response body when the server did not return JSON.
    }
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return response.json();
}

function setStatus(message) {
  if (!statusLine) return;
  if (statusLineTimer) {
    clearTimeout(statusLineTimer);
    statusLineTimer = null;
  }
  statusLine.textContent = message;
  statusLine.classList.toggle("is-visible", Boolean(message));
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  if (message) {
    statusLineTimer = setTimeout(() => {
      statusLine.textContent = "";
      statusLine.classList.remove("is-visible");
      statusLineTimer = null;
    }, 6500);
  }
}

function showButtonFeedback(target, message) {
  const button = target?.closest?.("button") ?? target;
  if (!button) {
    setStatus(message);
    return;
  }

  let feedback = button.nextElementSibling;
  if (!feedback?.classList.contains("button-feedback")) {
    feedback = document.createElement("span");
    feedback.className = "button-feedback";
    button.insertAdjacentElement("afterend", feedback);
  }

  const previousTimer = buttonFeedbackTimers.get(feedback);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  feedback.textContent = message;
  feedback.classList.add("is-visible");
  const timer = setTimeout(() => {
    feedback.classList.remove("is-visible");
    setTimeout(() => {
      if (!feedback.classList.contains("is-visible")) {
        feedback.remove();
      }
    }, 180);
  }, 2400);
  buttonFeedbackTimers.set(feedback, timer);
}

function setElementHelp(element, help) {
  if (!element || !help) return;
  element.title = help;
  element.setAttribute("aria-label", element.getAttribute("aria-label") || help);
}

function helpForElement(element) {
  if (!element) return null;
  if (element.id && adminTooltipById[element.id]) {
    return adminTooltipById[element.id];
  }
  if (element.name && adminTooltipByName[element.name]) {
    return adminTooltipByName[element.name];
  }
  if (element.dataset?.runAction && adminTooltipByRunAction[element.dataset.runAction]) {
    return adminTooltipByRunAction[element.dataset.runAction];
  }
  if (element.dataset?.adminSectionTarget && adminTooltipBySection[element.dataset.adminSectionTarget]) {
    return adminTooltipBySection[element.dataset.adminSectionTarget];
  }
  if (element.dataset?.settingsSection !== undefined) {
    const legend = element.closest(".settings-subsection")?.querySelector("legend")?.textContent?.trim();
    return legend ? `Save only the ${legend} section.` : "Save only this settings section.";
  }
  if (element.matches?.('button[type="submit"]')) {
    const formId = element.closest("form")?.id;
    if (formId === "scoring-form") return "Save scoring constants and apply them immediately.";
    if (formId === "general-settings-form") return "Save general timeline and search pacing settings.";
    if (formId === "search-without-api-form") return "Save Search without Api settings and apply mode changes immediately.";
    if (formId === "x-api-form") return "Save X API settings and apply mode changes immediately.";
    if (formId === "env-form") return "Save .env variables and restart the server when configured.";
    if (formId === "list-form") {
      const action = element.value || "add";
      if (action === "add") return "Add the typed value to the selected list.";
      if (action === "update") return "Update the currently selected list entry.";
      if (action === "delete") return "Delete the currently selected list entry.";
    }
  }
  return null;
}

function attachFieldHelp(element, help) {
  const label = element.closest("label");
  if (!label || label.dataset.helpAttached === "true") return;
  const labelText = Array.from(label.children).find((child) => child.tagName === "SPAN");
  if (!labelText) return;

  label.dataset.helpAttached = "true";
  labelText.classList.add("label-help-row");

  const helpId = `field-help-${Math.random().toString(36).slice(2)}`;
  const icon = document.createElement("span");
  icon.className = "help-icon";
  icon.textContent = "i";
  icon.setAttribute("role", "button");
  icon.setAttribute("tabindex", "0");
  icon.setAttribute("aria-label", "Show help");
  icon.setAttribute("aria-controls", helpId);
  icon.title = help;
  labelText.appendChild(icon);

  const helpText = document.createElement("p");
  helpText.id = helpId;
  helpText.className = "field-help";
  helpText.textContent = help;
  label.appendChild(helpText);

  const toggleHelp = (event) => {
    event.preventDefault();
    event.stopPropagation();
    helpText.classList.toggle("is-visible");
  };
  icon.addEventListener("click", toggleHelp);
  icon.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      toggleHelp(event);
    }
  });
}

function setupAdminHelp() {
  document.querySelectorAll("input, select, textarea, button, .nav-link").forEach((element) => {
    const help = helpForElement(element);
    if (!help) return;
    setElementHelp(element, help);
    if (element.matches("input, select, textarea")) {
      attachFieldHelp(element, help);
    }
  });
}

function setupPathPickers() {
  document.querySelectorAll("[data-path-picker]").forEach((input) => {
    input.classList.add("path-picker-input");
    input.addEventListener("click", (event) => {
      if (input.disabled || input.readOnly) return;
      event.preventDefault();
      openPathPicker(input).catch((error) => setStatus(error.message));
    });
  });

  pathPickerClose?.addEventListener("click", closePathPicker);
  pathPickerModal?.addEventListener("click", (event) => {
    if (event.target === pathPickerModal) {
      closePathPicker();
    }
  });
  pathPickerParent?.addEventListener("click", () => {
    if (!pathPickerState.parent) return;
    loadPathPicker(pathPickerState.parent).catch((error) => setStatus(error.message));
  });
  pathPickerUseCurrent?.addEventListener("click", () => {
    if (pathPickerState.mode !== "directory") return;
    choosePath(pathPickerState.cwd).catch((error) => setStatus(error.message));
  });
  pathPickerRoots?.addEventListener("click", (event) => {
    const rootButton = event.target.closest("[data-path-picker-root]");
    if (!rootButton) return;
    loadPathPicker(rootButton.dataset.pathPickerRoot).catch((error) => setStatus(error.message));
  });
  pathPickerEntries?.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-path-picker-select]");
    if (selectButton) {
      choosePath(selectButton.dataset.pathPickerSelect).catch((error) => setStatus(error.message));
      return;
    }

    const row = event.target.closest("[data-path-picker-entry]");
    if (!row) return;
    const entryPath = row.dataset.pathPickerEntry;
    if (row.dataset.pathPickerType === "directory") {
      loadPathPicker(entryPath).catch((error) => setStatus(error.message));
      return;
    }
    if (row.dataset.pathPickerSelectable === "true") {
      choosePath(entryPath).catch((error) => setStatus(error.message));
    }
  });
  pathPickerEntries?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-path-picker-entry]");
    if (!row) return;
    event.preventDefault();
    row.click();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pathPickerModal?.classList.contains("is-visible")) {
      closePathPicker();
    }
  });
}

async function openPathPicker(input) {
  if (!pathPickerModal) return;
  pathPickerState = {
    input,
    mode: input.dataset.pathPicker || "file",
    cwd: "",
    parent: null
  };
  pathPickerTitle.textContent = pathPickerState.mode === "directory" ? "Choose folder" : "Choose file";
  pathPickerModal.classList.add("is-visible");
  pathPickerModal.setAttribute("aria-hidden", "false");
  const startPath = input.value.trim() || input.dataset.pathPickerStart || ".";
  await loadPathPicker(startPath);
}

async function loadPathPicker(targetPath) {
  const mode = pathPickerState.mode || "file";
  const params = new URLSearchParams({
    mode,
    path: targetPath || "."
  });
  const extensions = pathPickerState.input?.dataset.pathPickerExtensions;
  if (extensions) {
    params.set("extensions", extensions);
  }
  const data = await jsonFetch(
    `/admin/filesystem/browse?${params.toString()}`
  );
  if (!data) return;

  pathPickerState.cwd = data.cwd;
  pathPickerState.parent = data.parent;
  pathPickerCurrent.textContent = data.cwd;
  pathPickerParent.disabled = !data.parent;
  pathPickerUseCurrent.hidden = mode !== "directory";
  pathPickerUseCurrent.disabled = mode !== "directory";

  pathPickerRoots.innerHTML = (data.roots || [])
    .map(
      (root) =>
        `<button type="button" class="secondary-button" data-path-picker-root="${escapeAttribute(root.path)}">${escapeHtml(
          root.label
        )}</button>`
    )
    .join("");

  if (!data.entries.length) {
    pathPickerEntries.innerHTML = '<div class="empty-state">No visible file in this folder.</div>';
    return;
  }

  pathPickerEntries.innerHTML = data.entries
    .map((entry) => {
      const icon = entry.type === "directory" ? "Dir" : "File";
      const meta = entry.type === "directory" ? "folder" : formatBytes(entry.size);
      const selectButton =
        entry.type === "directory" && mode === "directory"
          ? `<button type="button" class="secondary-button" data-path-picker-select="${escapeAttribute(
            entry.path
          )}">Select</button>`
          : "";
      return `<div class="path-picker-row" role="button" tabindex="0" data-path-picker-entry="${escapeAttribute(
        entry.path
      )}" data-path-picker-type="${escapeAttribute(entry.type)}" data-path-picker-selectable="${String(
        entry.selectable
      )}">
        <span class="path-picker-entry-main"><strong>${icon}</strong> ${escapeHtml(entry.name)}</span>
        <span class="path-picker-entry-meta">${escapeHtml(meta)}</span>
        ${selectButton}
      </div>`;
    })
    .join("");
}

async function choosePath(selectedPath) {
  if (!selectedPath || !pathPickerState.input) return;
  const input = pathPickerState.input;
  let finalPath = selectedPath;
  let copyStatus = null;
  let copiedOpenVpnPath = null;

  if (pathPickerState.mode === "file" && input.dataset.pathCopyTo) {
    const result = await jsonFetch("/admin/filesystem/copy", {
      method: "POST",
      body: JSON.stringify({
        sourcePath: selectedPath,
        targetDir: input.dataset.pathCopyTo
      })
    });
    if (!result) return;
    finalPath = result.relativePath || result.path || selectedPath;
    applyOpenVpnProfileMetadata(result.openVpn);
    copyStatus = result.copied
      ? `File copied to ${finalPath}.`
      : result.alreadyInTarget
        ? `File already in ${finalPath}.`
        : `Existing copy reused: ${finalPath}.`;
    if (result.openVpn?.isOpenVpnProfile) {
      copiedOpenVpnPath = finalPath;
      const remote = [result.openVpn.remoteHost, result.openVpn.remotePort, result.openVpn.remoteProto]
        .filter(Boolean)
        .join(":");
      const sanitizeStatus = result.openVpn.sanitized ? " OpenVPN profile sanitized." : " OpenVPN profile checked.";
      const authStatus = result.openVpn.authFileExists
        ? ` Auth ${result.openVpn.authCopied ? "copied" : "linked"}: ${result.openVpn.authFilePath}.`
        : ` Auth file expected: ${result.openVpn.authFilePath}.`;
      copyStatus += `${sanitizeStatus}${remote ? ` Remote ${remote}.` : ""}${authStatus}`;
    }
  }

  input.value = finalPath;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  closePathPicker();
  if (copyStatus) {
    setStatus(copyStatus);
  }
  if (copiedOpenVpnPath) {
    await refreshOpenVpnProfiles(copiedOpenVpnPath);
    const profile = findOpenVpnProfileByPath(copiedOpenVpnPath);
    if (profile) {
      openOpenVpnAuthDialog(profile);
    }
  }
}

function applyOpenVpnProfileMetadata(metadata) {
  if (!metadata?.isOpenVpnProfile || !searchWithoutApiForm) {
    return;
  }
  if (metadata.remoteHost && searchWithoutApiForm.elements.VPN_REMOTE_HOST) {
    searchWithoutApiForm.elements.VPN_REMOTE_HOST.value = metadata.remoteHost;
  }
  if (metadata.remotePort && searchWithoutApiForm.elements.VPN_REMOTE_PORT) {
    searchWithoutApiForm.elements.VPN_REMOTE_PORT.value = metadata.remotePort;
  }
  if (metadata.remoteProto && searchWithoutApiForm.elements.VPN_REMOTE_PROTO) {
    searchWithoutApiForm.elements.VPN_REMOTE_PROTO.value = metadata.remoteProto;
  }
}

function closePathPicker() {
  pathPickerModal?.classList.remove("is-visible");
  pathPickerModal?.setAttribute("aria-hidden", "true");
  pathPickerState = { input: null, mode: "file", cwd: "", parent: null };
}

function setupOpenVpnAuthDialog() {
  openVpnAuthButton?.addEventListener("click", () => {
    const profile = currentOpenVpnProfile();
    const configuredPath = searchWithoutApiForm.elements.VPN_CONFIG?.value?.trim();
    if (!profile && !configuredPath) {
      setStatus("Choose an OpenVPN profile first.");
      return;
    }
    openOpenVpnAuthDialog(profile, configuredPath);
  });
  openVpnAuthClose?.addEventListener("click", closeOpenVpnAuthDialog);
  openVpnAuthCancel?.addEventListener("click", closeOpenVpnAuthDialog);
  openVpnAuthModal?.addEventListener("click", (event) => {
    if (event.target === openVpnAuthModal) {
      closeOpenVpnAuthDialog();
    }
  });
  openVpnAuthForm?.addEventListener("submit", saveOpenVpnAuth);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openVpnAuthModal?.classList.contains("is-visible")) {
      closeOpenVpnAuthDialog();
    }
  });
}

function currentOpenVpnProfile() {
  return (
    findOpenVpnProfileByPath(openVpnProfileSelect?.value) ??
    findOpenVpnProfileByPath(searchWithoutApiForm.elements.VPN_CONFIG?.value)
  );
}

function openOpenVpnAuthDialog(profile, fallbackPath = "") {
  if (!openVpnAuthModal || !openVpnAuthForm) return;
  const profilePath = profile?.relativePath || fallbackPath || "";
  if (!profilePath) {
    setStatus("Choose an OpenVPN profile first.");
    return;
  }

  openVpnAuthProfilePath = profilePath;
  openVpnAuthForm.reset();
  if (openVpnAuthProfile) {
    const authPath = profile?.authFilePath ? ` Auth file: ${profile.authFilePath}.` : " Auth file will be created next to the profile.";
    openVpnAuthProfile.textContent = `${profile?.filename || profilePath}.${authPath}`;
  }
  openVpnAuthModal.classList.add("is-visible");
  openVpnAuthModal.setAttribute("aria-hidden", "false");
  openVpnAuthForm.elements.username?.focus();
}

function closeOpenVpnAuthDialog() {
  openVpnAuthModal?.classList.remove("is-visible");
  openVpnAuthModal?.setAttribute("aria-hidden", "true");
  openVpnAuthProfilePath = "";
  openVpnAuthForm?.reset();
}

async function saveOpenVpnAuth(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const username = openVpnAuthForm.elements.username.value;
  const password = openVpnAuthForm.elements.password.value;
  const result = await jsonFetch("/admin/vpn/profiles/auth", {
    method: "POST",
    body: JSON.stringify({
      profilePath: openVpnAuthProfilePath,
      username,
      password
    })
  });
  if (!result) return;

  closeOpenVpnAuthDialog();
  await refreshOpenVpnProfiles(result.profilePath);
  showButtonFeedback(submitter, "Saved.");
  setStatus(`OpenVPN auth file saved: ${result.authFilePath}.`);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) {
    return "unknown";
  }
  const value = Number(bytes);
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function renderMetric(label, value, text = false) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong${text ? ' class="metric-text"' : ""}>${escapeHtml(value)}</strong></div>`;
}

function databaseTableUrl(tableName, suffix = "") {
  return `/admin/database/tables/${encodeURIComponent(tableName)}${suffix}`;
}

function formatDatabaseValue(value) {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderDatabaseTable(rows, columns) {
  if (!rows.length) {
    return '<div class="empty-state">No data.</div>';
  }

  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const rawValue = typeof column.value === "function" ? column.value(row) : row[column.key];
          return `<td>${escapeHtml(formatDatabaseValue(rawValue))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table class="database-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderAvailabilityNote(block, label) {
  if (!block || block.available) return "";
  const error = block.error ? ` ${block.error}` : "";
  return `<div class="empty-state">${escapeHtml(label)} unavailable in this runtime.${escapeHtml(error)}</div>`;
}

function renderIpTable(rows) {
  return renderDatabaseTable(rows || [], [
    { key: "ip", label: "IP" },
    { key: "count", label: "Count" }
  ]);
}

function renderStringList(values) {
  const rows = (values || []).map((value) => ({ value }));
  return renderDatabaseTable(rows, [{ key: "value", label: "Value" }]);
}

async function refreshSystemHealth() {
  if (!systemHealthSummary) return;
  systemHealthSummary.innerHTML = '<div class="empty-state">Loading system health...</div>';
  const data = await jsonFetch("/admin/system/health");
  if (!data) return;

  if (systemHealthUpdated) {
    const source = data.environment?.source === "host-collector"
      ? "Host checks loaded from VPS collector."
      : data.environment?.source === "container-fallback"
        ? "Host collector missing; Docker containers cannot read VPS systemd logs directly."
        : "Host checks use the last 30 days when journalctl is available.";
    systemHealthUpdated.textContent = `Updated ${new Date(data.generatedAt).toLocaleString()}. ${source}`;
  }

  systemHealthSummary.innerHTML = [
    renderMetric("Runtime", data.environment?.inDocker ? "Docker container" : "host/local", true),
    renderMetric("Host", data.environment?.host || "-", true),
    renderMetric("SSH accepted logins", data.ssh?.available ? data.ssh.acceptedLogins ?? 0 : "unavailable", true),
    renderMetric("SSH failed attempts", data.ssh?.available ? data.ssh.failedAttempts ?? 0 : "unavailable", true),
    renderMetric("fail2ban sshd banned", data.fail2ban?.available ? data.fail2ban.sshd?.currentlyBanned ?? 0 : "unavailable", true),
    renderMetric("Web scan hits", data.caddy?.available ? data.caddy.suspiciousRequests ?? 0 : "unavailable", true),
    renderMetric("Webhook invalid signatures", data.webhook?.available ? data.webhook.invalidSignatures ?? 0 : "unavailable", true)
  ].join("");

  if (systemHealthServices) {
    systemHealthServices.innerHTML = renderDatabaseTable(data.services || [], [
      { key: "name", label: "Service" },
      { key: "status", label: "Status" },
      { key: "error", label: "Note" }
    ]);
  }

  if (systemHealthSsh) {
    systemHealthSsh.innerHTML = [
      renderAvailabilityNote(data.ssh, "SSH logs"),
      data.ssh?.available ? `<h3>SSH login IPs</h3>${renderIpTable(data.ssh.loginIps)}<h3>SSH failed source IPs</h3>${renderIpTable(data.ssh.topIps)}` : "",
      renderAvailabilityNote(data.fail2ban, "fail2ban"),
      data.fail2ban?.available
        ? `<h3>fail2ban sshd</h3>${renderDatabaseTable([data.fail2ban.sshd || {}], [
            { key: "currentlyBanned", label: "Currently banned" },
            { key: "totalBanned", label: "Total banned" }
          ])}<h3>Banned IPs</h3>${renderStringList(data.fail2ban.sshd?.bannedIps || [])}<h3>Jails</h3>${renderStringList(data.fail2ban.jails || [])}`
        : ""
    ].join("");
  }

  if (systemHealthWeb) {
    systemHealthWeb.innerHTML = [
      renderAvailabilityNote(data.caddy, "Caddy logs"),
      data.caddy?.available ? `<h3>Scanner IPs</h3>${renderIpTable(data.caddy.topIps)}` : ""
    ].join("");
  }

  if (systemHealthRuntime) {
    systemHealthRuntime.innerHTML = [
      renderAvailabilityNote(data.webhook, "Webhook logs"),
      data.webhook?.available
        ? `<h3>Webhook</h3>${renderDatabaseTable([data.webhook], [
            { key: "posts", label: "POSTs" },
            { key: "invalidSignatures", label: "Invalid signatures" },
            { key: "errors", label: "Errors" }
          ])}<h3>Webhook IPs</h3>${renderIpTable(data.webhook.topIps)}`
        : "",
      renderAvailabilityNote(data.docker, "Docker compose"),
      data.docker?.available
        ? `<h3>Docker compose services</h3>${renderDatabaseTable(data.docker.services || [], [
            { key: "name", label: "Container" },
            { key: "status", label: "Status" }
          ])}`
        : ""
    ].join("");
  }
}

function renderDatabasePreview(rows) {
  if (!rows.length) {
    return '<div class="empty-state">This table is empty.</div>';
  }

  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set())).map((key) => ({ key, label: key }));
  return renderDatabaseTable(rows, columns);
}

function renderDatabaseOverview(data) {
  const db = data.database;
  databaseState.tables = data.tables || [];
  databaseSummary.innerHTML = [
    renderMetric("Database file", db.path, true),
    renderMetric("Total file size", formatBytes(db.totalFileBytes), true),
    renderMetric("Main database", formatBytes(db.databaseBytes), true),
    renderMetric("WAL file", formatBytes(db.walBytes), true),
    renderMetric("SHM file", formatBytes(db.shmBytes), true),
    renderMetric("Page size", `${db.pageSize} B`, true),
    renderMetric("Pages", db.pageCount),
    renderMetric("Free pages", db.freelistCount)
  ].join("");

  databaseTableCount.textContent = `${databaseState.tables.length} table${databaseState.tables.length === 1 ? "" : "s"}`;
  renderDatabaseTableList();
}

function renderDatabaseTableList() {
  if (!databaseState.tables.length) {
    databaseTables.innerHTML = '<div class="empty-state">No SQLite table.</div>';
    databaseState.selectedTable = null;
    renderEmptyDatabaseDetail();
    return;
  }

  const sortedTables = [...databaseState.tables].sort((left, right) => {
    const rightSize = right.totalBytes ?? -1;
    const leftSize = left.totalBytes ?? -1;
    return rightSize - leftSize || left.name.localeCompare(right.name);
  });

  databaseTables.innerHTML = sortedTables
    .map((table) => {
      const selected = table.name === databaseState.selectedTable ? " is-selected" : "";
      const rows = `${table.rowCount} row${table.rowCount === 1 ? "" : "s"}`;
      const size = formatBytes(table.totalBytes);
      return `<button class="list-row database-table-row${selected}" type="button" data-table-name="${encodeURIComponent(table.name)}" title="Select this SQLite table to inspect schema, indexes, preview rows, export data, or empty it.">
        <span><strong>${escapeHtml(table.name)}</strong><br>${escapeHtml(rows)}</span>
        <span>${escapeHtml(size)}<br>${table.indexCount} index${table.indexCount === 1 ? "" : "es"}</span>
      </button>`;
    })
    .join("");
}

function renderEmptyDatabaseDetail() {
  databaseTableTitle.textContent = "Table details";
  databaseTableSummary.innerHTML = "";
  databaseSchema.textContent = "Select a table.";
  databaseColumns.innerHTML = "";
  databaseIndexes.innerHTML = "";
  databaseForeignKeys.innerHTML = "";
  databasePreview.innerHTML = "";
  databaseDownloadJsonButton.disabled = true;
  databaseDownloadCsvButton.disabled = true;
  databaseClearTableButton.disabled = true;
}

function renderDatabaseDetail(detail) {
  databaseState.selectedTable = detail.name;
  databaseTableTitle.textContent = detail.name;
  databaseTableSummary.innerHTML = [
    renderMetric("Rows", detail.rowCount),
    renderMetric("Data size", formatBytes(detail.dataBytes), true),
    renderMetric("Index size", formatBytes(detail.indexBytes), true),
    renderMetric("Total size", formatBytes(detail.totalBytes), true)
  ].join("");
  databaseSchema.textContent = detail.schemaSql || "No schema SQL.";
  databaseColumns.innerHTML = renderDatabaseTable(detail.columns, [
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "notnull", label: "Required", value: (row) => (row.notnull ? "yes" : "no") },
    { key: "dflt_value", label: "Default" },
    { key: "pk", label: "Primary key", value: (row) => (row.pk ? "yes" : "no") }
  ]);
  databaseIndexes.innerHTML = renderDatabaseTable(detail.indexes, [
    { key: "name", label: "Name" },
    { key: "unique", label: "Unique", value: (row) => (row.unique ? "yes" : "no") },
    { key: "origin", label: "Origin" },
    { key: "partial", label: "Partial", value: (row) => (row.partial ? "yes" : "no") }
  ]);
  databaseForeignKeys.innerHTML = renderDatabaseTable(detail.foreignKeys, [
    { key: "table", label: "Table" },
    { key: "from", label: "From" },
    { key: "to", label: "To" },
    { key: "on_update", label: "On update" },
    { key: "on_delete", label: "On delete" }
  ]);
  databasePreview.innerHTML = renderDatabasePreview(detail.sampleRows);
  databaseDownloadJsonButton.disabled = false;
  databaseDownloadCsvButton.disabled = false;
  databaseClearTableButton.disabled = false;
  renderDatabaseTableList();
}

async function refreshDatabaseOverview() {
  const data = await jsonFetch("/admin/database/overview");
  if (!data) return;
  renderDatabaseOverview(data);

  const selectedStillExists = databaseState.tables.some((table) => table.name === databaseState.selectedTable);
  const nextSelected = selectedStillExists ? databaseState.selectedTable : databaseState.tables[0]?.name;
  if (nextSelected) {
    await selectDatabaseTable(nextSelected);
  } else {
    renderEmptyDatabaseDetail();
  }
}

async function selectDatabaseTable(tableName) {
  const detail = await jsonFetch(`${databaseTableUrl(tableName)}?limit=25`);
  if (!detail) return;
  renderDatabaseDetail(detail);
}

function downloadDatabaseTable(format) {
  if (!databaseState.selectedTable) return;
  window.location.href = `${databaseTableUrl(databaseState.selectedTable, "/export")}?format=${format}`;
}

async function clearSelectedDatabaseTable() {
  const tableName = databaseState.selectedTable;
  if (!tableName) return;

  const typed = window.prompt(`Type ${tableName} to empty this SQLite table completely.`);
  if (typed === null) return;
  if (typed !== tableName) {
    setStatus("Table was not emptied: confirmation did not match.");
    return;
  }

  const result = await jsonFetch(databaseTableUrl(tableName, "/clear"), {
    method: "POST",
    body: JSON.stringify({ confirm: typed })
  });
  if (!result) return;
  setStatus(`Table emptied: ${result.table}, ${result.deletedRows} row${result.deletedRows === 1 ? "" : "s"} deleted.`);
  await refreshStats();
  await refreshDatabaseOverview();
}

async function runDatabaseMaintenance(action) {
  const labels = {
    "integrity-check": "Integrity check",
    analyze: "Analyze",
    vacuum: "Vacuum"
  };
  setStatus(`${labels[action]} running...`);
  const result = await jsonFetch(`/admin/database/${action}`, { method: "POST" });
  if (!result) return;

  if (action === "integrity-check") {
    const details = Array.isArray(result.results) ? result.results.join(", ") : "";
    setStatus(`Integrity check: ${result.ok ? "ok" : "problem"}${details ? ` (${details})` : ""}.`);
    return;
  }

  setStatus(`${labels[action]} completed.`);
  await refreshDatabaseOverview();
}

async function refreshStats() {
  const data = await jsonFetch("/admin/stats");
  if (!data) return;
  currentRuntimeModes = data.runtimeModes || {};
  applyAdminAuthModeUi();
  openXSessionAlerts = data.xSessionAlerts || [];
  latestListCounts = data.lists || {};
  updateSuggestedKeywordControls();
  renderXSessionAlertHeader();

  const listCounts = data.lists || {};
  metrics.innerHTML = visibleMetricDefinitions(data.runtimeModes)
    .map(([kind, label]) => {
      const value = listCounts[kind] || 0;
      return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
    })
    .join("") + renderRunCounterMetric(data.currentRun) + renderXBudgetMetrics(data.xBudget, data.runtimeModes) + renderSearchWithoutApiMetrics(data.searchWithoutApi);
  renderSessionKeywordWarning(data.searchWithoutApi);
  if (countersUpdatedAt) {
    countersUpdatedAt.textContent = `Updated ${new Date().toLocaleString()}`;
  }
  renderRunStatus(data.currentRun, data.staleKeywordUserPrune);
}

function visibleMetricDefinitions(runtimeModes = {}) {
  return metricDefinitions.filter(([kind]) => runtimeModes.xApiEnabled !== false || !xApiOnlyCounterKinds.has(kind));
}

function renderRunCounterMetric(run) {
  if (!run) {
    return '<div class="metric"><span>Active run</span><strong class="metric-text">No active run</strong></div>';
  }
  return `<div class="metric"><span>Active run</span><strong class="metric-text metric-ok">${escapeHtml(run.status)} - ${escapeHtml(run.id)}</strong></div>`;
}

function renderXBudgetMetrics(budget, runtimeModes = {}) {
  if (!budget || runtimeModes.xApiEnabled === false) return "";
  const apiCreditUsd = Number(budget.apiCreditUsd ?? budget.remainingApiCreditUsd ?? 0);
  const apiTotalCreditUsedUsd = Number(budget.apiTotalCreditUsedUsd ?? 0);
  const projectedTotalCreditUsedUsd = Number(budget.projectedTotalCreditUsedUsd ?? apiTotalCreditUsedUsd);
  const apiCredit = `$${apiCreditUsd.toFixed(3)} remaining`;
  const totalCreditUsed = `$${apiTotalCreditUsedUsd.toFixed(3)}`;
  const projectedTotalCreditUsed = `$${projectedTotalCreditUsedUsd.toFixed(3)} with local estimate`;
  const spendLimit = budget.remainingDailySpendUsd === null ? "unlimited" : `$${budget.remainingDailySpendUsd.toFixed(3)} remaining`;
  const runSpendLimit = budget.remainingRunSpendUsd === null ? "no run" : `$${budget.remainingRunSpendUsd.toFixed(3)} remaining`;
  const searches = budget.remainingSearches === null ? "unlimited" : `${budget.remainingSearches} remaining`;
  const posts = budget.remainingPostReads === null ? "unlimited" : `${budget.remainingPostReads} remaining`;
  const counts = budget.remainingCountCalls === null ? "unlimited" : `${budget.remainingCountCalls} remaining`;
  return `
    <div class="metric"><span>X estimated cost today</span><strong>$${budget.estimatedCostUsd.toFixed(3)}</strong></div>
    <div class="metric"><span>X remaining API credit</span><strong class="metric-text">${apiCredit}</strong></div>
    <div class="metric"><span>X total credit used</span><strong class="metric-text">${totalCreditUsed}</strong></div>
    <div class="metric"><span>X projected total used</span><strong class="metric-text">${projectedTotalCreditUsed}</strong></div>
    <div class="metric"><span>X daily budget</span><strong class="metric-text">${spendLimit}</strong></div>
    <div class="metric"><span>X budget run</span><strong class="metric-text">${runSpendLimit}</strong></div>
    <div class="metric"><span>X searches today</span><strong class="metric-text">${budget.searchCalls} / ${searches}</strong></div>
    <div class="metric"><span>X count-first today</span><strong class="metric-text">${budget.countCalls} / ${counts}</strong></div>
    <div class="metric"><span>X posts read today</span><strong class="metric-text">${budget.postReads} / ${posts}</strong></div>
    <div class="metric"><span>X manual actions</span><strong>${budget.userInteractions}</strong></div>
  `;
}

function renderSearchWithoutApiMetrics(stats) {
  if (!stats?.enabled) return "";
  const available = stats.availableKeywords ?? 0;
  return `
    <div class="metric"><span>Keywords per session</span><strong>${formatSessionKeywordLimit(stats)}</strong></div>
    <div class="metric"><span>@user keyword target</span><strong>${stats.userKeywordPercent ?? 100}%</strong></div>
    <div class="metric"><span>Active keyword entries</span><strong>${stats.keywordTotal ?? 0}</strong></div>
    <div class="metric"><span>SearchTerms.Used saved</span><strong>${stats.searchTermsUsedKeywords ?? stats.searchedKeywords ?? 0}</strong></div>
    <div class="metric"><span>Active keywords already searched</span><strong>${stats.excludedAlreadySearchedKeywords ?? 0}</strong></div>
    <div class="metric"><span>Available keywords now</span><strong>${available}</strong></div>
  `;
}

function renderSessionKeywordWarning(stats) {
  if (!sessionKeywordWarning) return;
  const available = stats?.availableKeywords ?? 0;
  if (!stats?.enabled || (stats.keywordTotal ?? 0) <= 0 || available > 0) {
    sessionKeywordWarning.innerHTML = "";
    return;
  }
  sessionKeywordWarning.innerHTML = `<div class="metric metric-wide is-warning"><span>No eligible keywords remain</span><strong class="metric-text">${keywordExhaustionText(stats)}</strong></div>`;
}

function keywordExhaustionText(stats) {
  const searched = stats.excludedAlreadySearchedKeywords ?? 0;
  const noResult = stats.excludedNoResultKeywords ?? 0;
  return `${searched} already in SearchTerms.Used, ${noResult} in No.Result. Clear one of those lists to search again.`;
}

function formatSessionKeywordLimit(stats) {
  const limit = Number(stats?.sessionKeywordLimit ?? 0);
  if (!limit) return "all eligible";
  return stats?.sessionKeywordLimitRandom ? `random 1 - ${limit}` : String(limit);
}

async function refreshOpenVpnProfiles(activePath = null) {
  if (!openVpnProfileSelect) return;
  const data = await jsonFetch("/admin/vpn/profiles");
  if (!data) return;
  openVpnProfiles = data.profiles || [];
  renderOpenVpnProfiles(activePath ?? searchWithoutApiForm.elements.VPN_CONFIG?.value ?? "");
  await refreshXBrowserAccounts();
}

function renderOpenVpnProfiles(activePath) {
  if (!openVpnProfileSelect) return;
  const selectedProfile = findOpenVpnProfileByPath(activePath);
  const options = [
    '<option value="">No profile selected</option>',
    ...openVpnProfiles.map((profile) => {
      const selected = selectedProfile?.relativePath === profile.relativePath ? " selected" : "";
      const remote = [profile.remoteHost, profile.remotePort, profile.remoteProto].filter(Boolean).join(":");
      const label = remote ? `${profile.filename} - ${remote}` : profile.filename;
      return `<option value="${escapeAttribute(profile.relativePath)}"${selected}>${escapeHtml(label)}</option>`;
    })
  ];
  openVpnProfileSelect.innerHTML = options.join("");
  renderOpenVpnProfileDetail(selectedProfile, activePath);
}

function findOpenVpnProfileByPath(value) {
  const target = profilePathKey(value);
  if (!target) return null;
  return (
    openVpnProfiles.find((profile) =>
      [profile.relativePath, profile.path].some((candidate) => profilePathKey(candidate) === target)
    ) ?? null
  );
}

function profilePathKey(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function selectOpenVpnProfile(profile) {
  if (!profile || !searchWithoutApiForm) return;
  if (searchWithoutApiForm.elements.VPN_CONFIG) {
    searchWithoutApiForm.elements.VPN_CONFIG.value = profile.relativePath;
  }
  if (profile.remoteHost && searchWithoutApiForm.elements.VPN_REMOTE_HOST) {
    searchWithoutApiForm.elements.VPN_REMOTE_HOST.value = profile.remoteHost;
  }
  if (profile.remotePort && searchWithoutApiForm.elements.VPN_REMOTE_PORT) {
    searchWithoutApiForm.elements.VPN_REMOTE_PORT.value = profile.remotePort;
  }
  if (profile.remoteProto && searchWithoutApiForm.elements.VPN_REMOTE_PROTO) {
    searchWithoutApiForm.elements.VPN_REMOTE_PROTO.value = profile.remoteProto;
  }
  renderOpenVpnProfileDetail(profile, profile.relativePath);
  renderXBrowserAccountPanel(profile.relativePath);
}

function renderOpenVpnProfileDetail(profile, activePath = "") {
  if (!openVpnProfileDetail) return;
  if (!profile) {
    openVpnProfileDetail.textContent = activePath
      ? `Active config path is ${activePath}, but no imported profile metadata was found in ./ops/vpn.`
      : "Import or select an OpenVPN profile from ./ops/vpn.";
    return;
  }

  const endpoint = [profile.remoteHost, profile.remotePort, profile.remoteProto].filter(Boolean).join(":") || "missing remote";
  const auth = profile.authFilePath
    ? `${profile.authFileExists ? "auth ok" : "auth missing"}: ${profile.authFilePath}`
    : "no auth file expected";
  const warnings = profile.warnings?.length ? ` Warnings: ${profile.warnings.join(" ")}` : "";
  openVpnProfileDetail.textContent = `${profile.filename} - ${endpoint} - ${auth}.${warnings}`;
}

async function refreshXBrowserAccounts() {
  if (!xBrowserAccountSelect) return;
  const [data, alertsData] = await Promise.all([jsonFetch("/admin/x-browser-accounts"), jsonFetch("/admin/x-session-alerts")]);
  if (!data) return;
  xBrowserAccounts = data.accounts || [];
  if (alertsData) {
    openXSessionAlerts = alertsData.alerts || [];
    recentXSessionAlerts = alertsData.recent || [];
    renderXSessionAlertHeader();
    renderSessionAlertsPanel();
  }
  renderXBrowserAccountPanel(currentVpnProfilePath());
}

function renderXBrowserAccountPanel(vpnProfilePath = currentVpnProfilePath()) {
  if (!xBrowserAccountSelect) return;
  const selectedAccount = accountForVpnProfile(vpnProfilePath);
  const selectedAccountId = selectedAccount?.id ?? "";
  xBrowserAccountSelect.innerHTML = [
    '<option value="">No account linked</option>',
    ...xBrowserAccounts.map((account) => {
      const selected = account.id === selectedAccountId ? " selected" : "";
      const linkedCount = account.vpnProfilePaths?.length ?? 1;
      const suffix = linkedCount > 1 ? `${linkedCount} VPN profiles` : account.vpnProfilePath;
      const locked = account.openAlert ? " - LOCKED" : "";
      return `<option value="${escapeAttribute(account.id)}"${selected}>${escapeHtml(account.xIdentifier)} - ${escapeHtml(suffix)}${locked}</option>`;
    })
  ].join("");

  if (xBrowserIdentifier) {
    xBrowserIdentifier.value = selectedAccount?.xIdentifier ?? "";
  }
  if (xBrowserStorageState) {
    xBrowserStorageState.value = selectedAccount?.storageStatePath ?? "";
  }
  if (xBrowserAccountDelete) {
    xBrowserAccountDelete.disabled = !selectedAccount;
  }
  if (xBrowserSessionImport) {
    xBrowserSessionImport.disabled = !selectedAccount;
  }
  if (xBrowserSessionExport) {
    xBrowserSessionExport.disabled = !selectedAccount?.storageStateExists;
  }
  if (xBrowserLinkAllProfiles) {
    xBrowserLinkAllProfiles.checked = Boolean(selectedAccount && (selectedAccount.vpnProfilePaths?.length ?? 1) >= openVpnProfiles.length && openVpnProfiles.length > 1);
  }

  renderXBrowserSessionValidation(selectedAccount);
  renderXBrowserAccountDetail(selectedAccount, vpnProfilePath);
}

function renderXBrowserSessionValidation(account) {
  if (!xBrowserSessionValidation) return;
  xBrowserSessionValidation.classList.remove("is-valid", "is-missing", "is-locked");
  if (!account) {
    xBrowserSessionValidation.classList.add("is-missing");
    xBrowserSessionValidation.textContent = "No browser session saved yet.";
    return;
  }
  if (account.openAlert) {
    xBrowserSessionValidation.classList.add("is-locked");
    xBrowserSessionValidation.textContent = "X account locked by a manual verification alert.";
    return;
  }
  if (account.storageStateExists) {
    xBrowserSessionValidation.classList.add("is-valid");
    xBrowserSessionValidation.textContent = "X Browser session saved and ready.";
    return;
  }
  xBrowserSessionValidation.classList.add("is-missing");
  xBrowserSessionValidation.textContent = "X Browser session file missing. Run the local login command.";
}

function renderXBrowserAccountDetail(account, vpnProfilePath = currentVpnProfilePath()) {
  if (!xBrowserAccountDetail || !xBrowserLoginCommand) return;
  if (!vpnProfilePath) {
    xBrowserAccountDetail.textContent = "Choose an OpenVPN profile before linking an X account.";
    xBrowserLoginCommand.textContent = "Choose an OpenVPN profile first.";
    renderXBrowserLoginHelp(null);
    return;
  }
  if (!account) {
    xBrowserAccountDetail.textContent =
      "No X browser account is linked to this OpenVPN profile yet. Save a handle after creating the X account.";
    xBrowserLoginCommand.textContent = "Save an account first.";
    renderXBrowserLoginHelp(null);
    return;
  }

  const session = account.storageStateExists ? "session file present" : "session file missing";
  const lastLogin = account.lastLoginAt ? ` Last login: ${new Date(account.lastLoginAt).toLocaleString()}.` : "";
  const ip = account.lastLoginPublicIpv4 ? ` Login IPv4: ${account.lastLoginPublicIpv4}.` : "";
  const linkedCount = account.vpnProfilePaths?.length ?? 1;
  const linked = linkedCount > 1 ? ` Linked VPN profiles: ${linkedCount}.` : ` Linked VPN profile: ${account.vpnProfilePath}.`;
  const lock = account.openAlert ? ` LOCKED by alert #${account.openAlert.id}: ${account.openAlert.alertType}.` : "";
  const noVnc = currentSearchIsolation() === "docker_vpn" ? ` noVNC: ${xLoginNoVncUrl()}.` : "";
  xBrowserAccountDetail.textContent = `${account.sessionStatus} - ${session}.${linked}${lastLogin}${ip}${lock}${noVnc}`;
  xBrowserLoginCommand.textContent = xLoginCommandDisplay(account.id);
  renderXBrowserLoginHelp(account);
}

function renderXBrowserLoginHelp(account) {
  if (!xBrowserLoginHelp) return;
  if (!account) {
    xBrowserLoginHelp.textContent = "";
    return;
  }
  if (currentSearchIsolation() === "docker_vpn") {
    const noVncUrl = xLoginNoVncUrl();
    const tunnelCommand = xLoginSshTunnelCommand();
    xBrowserLoginHelp.innerHTML =
      `Run the command on the machine running Docker. It opens X in noVNC, not in a local desktop window. ` +
      `On a local machine, open <a href="${escapeAttribute(noVncUrl)}" target="_blank" rel="noreferrer">${escapeHtml(noVncUrl)}</a>. ` +
      `On a VPS, keep the x-login terminal open on the VPS. From your local PC, open a second terminal and run <code>${escapeHtml(tunnelCommand)}</code>, replacing <code>&lt;user&gt;@&lt;vps-host&gt;</code> with your SSH login. Then open the same URL locally. ` +
      `Log in to X inside noVNC, then press Enter in the x-login terminal to save the session. ` +
      `With Firefox, the session is saved automatically when X Home is visible. Use the noVNC side-panel clipboard if host paste does not sync.`;
    return;
  }
  xBrowserLoginHelp.textContent =
    "Host namespace login opens a visible Chrome window on this computer. Log in to X there, then press Enter in the terminal to save the session.";
}

function xLoginNoVncUrl() {
  return `http://127.0.0.1:${xLoginNoVncPort()}/vnc.html?autoconnect=1&resize=scale`;
}

function xLoginNoVncPort() {
  return searchWithoutApiForm.elements.X_LOGIN_NOVNC_PORT?.value || "6080";
}

function xLoginSshTunnelCommand() {
  const noVncPort = xLoginNoVncPort();
  return `ssh -L ${noVncPort}:127.0.0.1:${noVncPort} <user>@<vps-host>`;
}

function currentSearchIsolation() {
  return searchWithoutApiForm.elements.SEARCH_WITHOUT_API_ISOLATION?.value || "host_netns";
}

function currentAdminAuthMode() {
  return currentRuntimeModes.adminAuthMode || envForm?.elements?.ADMIN_AUTH_MODE?.value || "password";
}

function applyAdminAuthModeUi() {
  const isClientCertMode = currentAdminAuthMode() === "mtls_proxy";
  serverAccessForm?.classList.toggle("is-disabled", isClientCertMode);
  for (const field of serverAccessForm?.querySelectorAll("textarea, button") || []) {
    field.disabled = isClientCertMode;
  }
  if (serverAccessDisabledNote) {
    serverAccessDisabledNote.classList.toggle("is-hidden", !isClientCertMode);
    serverAccessDisabledNote.textContent = isClientCertMode
      ? "Client certificate authentication is active. IPv4 whitelist and blacklist are ignored in this mode."
      : "";
  }
  for (const fieldName of ["ADMIN_IPV4_WHITELIST", "ADMIN_IPV4_BLACKLIST"]) {
    const field = envForm?.elements?.[fieldName];
    if (field) {
      field.disabled = isClientCertMode;
      field.closest("label")?.classList.toggle("is-disabled", isClientCertMode);
    }
  }
}

function xLoginCommand(accountId, extraArgs = "") {
  const base =
    currentSearchIsolation() === "docker_vpn"
      ? `docker compose run --rm --service-ports x-login --account-id ${accountId}`
      : `npm run netns:x-login -- --account-id ${accountId}`;
  return extraArgs ? `${base} ${extraArgs}` : base;
}

function xLoginCommandDisplay(accountId, extraArgs = "") {
  const command = xLoginCommand(accountId, extraArgs);
  if (currentSearchIsolation() !== "docker_vpn") {
    return command;
  }
  return [
    command,
    `# noVNC: ${xLoginNoVncUrl()}`,
    `# VPS tunnel from your local PC: ${xLoginSshTunnelCommand()}`
  ].join("\n");
}

function xLoginAlertArgs() {
  return currentSearchIsolation() === "docker_vpn"
    ? "--resolve-alert"
    : "--resolve-alert --auto-save-on-login --hold-open-after-save";
}

function currentVpnProfilePath() {
  const selectedProfile = findOpenVpnProfileByPath(openVpnProfileSelect?.value);
  return selectedProfile?.relativePath || searchWithoutApiForm.elements.VPN_CONFIG?.value?.trim() || "";
}

function accountForVpnProfile(vpnProfilePath) {
  const target = profilePathKey(vpnProfilePath);
  if (!target) return null;
  return (
    xBrowserAccounts.find((account) =>
      (account.vpnProfilePaths?.length ? account.vpnProfilePaths : [account.vpnProfilePath]).some(
        (profilePath) => profilePathKey(profilePath) === target
      )
    ) ?? null
  );
}

function accountById(accountId) {
  const numericId = Number(accountId);
  return xBrowserAccounts.find((account) => account.id === numericId) ?? null;
}

function selectedXBrowserAccount() {
  return accountById(xBrowserAccountSelect?.value) ?? accountForVpnProfile(currentVpnProfilePath());
}

async function saveXBrowserAccount() {
  const vpnProfilePath = currentVpnProfilePath();
  const linkAllProfiles = Boolean(xBrowserLinkAllProfiles?.checked);
  const vpnProfilePaths = linkAllProfiles ? openVpnProfiles.map((profile) => profile.relativePath) : [vpnProfilePath].filter(Boolean);

  if (!vpnProfilePaths.length) {
    setStatus("Choose an OpenVPN profile before saving the X account link.");
    return;
  }
  const xIdentifier = xBrowserIdentifier?.value?.trim();
  if (!xIdentifier) {
    setStatus("Enter the X account identifier first.");
    return;
  }

  const result = await jsonFetch("/admin/x-browser-accounts", {
    method: "POST",
    body: JSON.stringify({
      accountId: accountById(xBrowserAccountSelect?.value)?.id,
      vpnProfilePath: vpnProfilePaths[0],
      vpnProfilePaths,
      xIdentifier,
      replaceProfiles: linkAllProfiles
    })
  });
  if (!result) return;
  await refreshXBrowserAccounts();
  renderXBrowserAccountPanel(result.account.vpnProfilePath);
  showButtonFeedback(xBrowserAccountSave, "Saved.");
  const linkedCount = result.account.vpnProfilePaths?.length ?? 1;
  setStatus(`X browser account linked to ${linkedCount} OpenVPN profile${linkedCount > 1 ? "s" : ""}.`);
}

async function deleteSelectedXBrowserAccount() {
  const account = selectedXBrowserAccount();
  if (!account) return;
  const confirmed = window.confirm(`Delete the X browser account link for ${account.xIdentifier}? The session file stays on disk.`);
  if (!confirmed) return;

  const result = await jsonFetch(`/admin/x-browser-accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
  if (!result) return;
  await refreshXBrowserAccounts();
  setStatus(`X browser account link deleted: ${account.xIdentifier}.`);
}

function exportSelectedXBrowserSession() {
  const account = selectedXBrowserAccount();
  if (!account) {
    setStatus("Select or save an X browser account before exporting a session.");
    return;
  }
  if (!account.storageStateExists) {
    setStatus("No X browser session file exists for this account yet.");
    return;
  }
  window.location.href = `/admin/x-browser-accounts/${encodeURIComponent(account.id)}/session`;
}

async function importSelectedXBrowserSessionFile(file) {
  const account = selectedXBrowserAccount();
  if (!account) {
    setStatus("Select or save an X browser account before importing a session.");
    return;
  }
  if (!file) return;
  const confirmed = window.confirm(
    `Import this X browser session for ${account.xIdentifier}? This overwrites the saved session file at ${account.storageStatePath}.`
  );
  if (!confirmed) return;

  const content = await file.text();
  const result = await jsonFetch(`/admin/x-browser-accounts/${encodeURIComponent(account.id)}/session`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      content
    })
  });
  if (!result) return;

  await refreshXBrowserAccounts();
  showButtonFeedback(xBrowserSessionImport, "Imported.");
  setStatus(`X browser session imported for ${result.account.xIdentifier}.`);
}

async function shutdownOpenVpn() {
  const confirmed = window.confirm(
    "Shutdown the VPN namespace now? This stops any active RedqueenX run and closes commands running inside the VPN namespace."
  );
  if (!confirmed) return;

  const result = await jsonFetch("/admin/vpn/shutdown", { method: "POST" });
  if (!result) return;

  const runMessage = result.runStopped ? "Run stopped. " : "No active run. ";
  const commandMessage = result.netnsCommands?.stop?.requested ? "Namespace commands stopped. " : "";
  const vpnStop = result.openVpn?.stop;
  const vpnMessage = vpnStop?.requested
    ? vpnStop.stillRunning?.length
      ? "VPN stop requested; cleanup still closing."
      : "VPN stopped."
    : vpnStop?.reason === "no_running_openvpn_script"
      ? "No running OpenVPN process found."
      : "VPN shutdown requested.";
  const teardown = result.namespace?.teardown;
  const teardownMessage = teardown?.requested
    ? " Namespace cleaned."
    : teardown?.reason === "teardown_needs_sudo_or_failed"
      ? " Run npm run netns:teardown to finish cleanup."
      : "";
  showButtonFeedback(openVpnShutdownButton, "Shutdown.");
  setStatus(`${runMessage}${commandMessage}${vpnMessage}${teardownMessage}`);
  await refreshStats();
  if (activeAdminSection() === "session") {
    await refreshCurrentSession();
  }
}

async function checkOpenVpnSudoStatus() {
  if (currentSearchIsolation() === "docker_vpn") {
    const message = "Docker VPN mode does not use the host root helper.";
    if (openVpnSudoDetail) {
      openVpnSudoDetail.textContent = message;
    }
    setStatus(message);
    return;
  }
  const result = await jsonFetch("/admin/vpn/sudo-status");
  if (!result) return;

  const message = result.available
    ? "Ready: Start/Resume can prepare the VPN namespace without a sudo password prompt."
    : `Setup required: run ${result.command} once, then click this check again. Temporary fallback: keep ${result.fallbackCommand} running before pressing Start.`;

  if (openVpnSudoDetail) {
    openVpnSudoDetail.textContent = message;
  }
  showButtonFeedback(openVpnSudoStatusButton, result.available ? "Ready." : "Needs terminal.");
  setStatus(message);
}

function renderImportFileDetail() {
  if (!pendingImports.length) {
    const selectedFiles = selectedImportFiles();
    if (!selectedFiles.length) {
      importFileDetail.textContent = "";
      return;
    }
    const label = selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} selected files`;
    importFileDetail.textContent = `${label}. Click Import to load.`;
    return;
  }

  if (pendingImports.length === 1) {
    const pendingImport = pendingImports[0];
    const extra = pendingImport.kind === "rss_sent" ? " URLs will also be added to RSS feeds." : "";
    importFileDetail.textContent = `${pendingImport.filename} - ${pendingImport.kind} - ${pendingImport.totalLines} lines imported into the interface.${extra}`;
    return;
  }

  const totalLines = pendingImports.reduce((sum, item) => sum + item.totalLines, 0);
  importFileDetail.textContent = `${pendingImports.length} files imported into the interface - ${totalLines} lines.`;
}

async function loadNextListPage() {
  if (listState.loading || !listState.hasMore) return;
  listState.loading = true;
  renderListLoader();

  try {
    const params = new URLSearchParams({
      limit: String(listState.limit),
      offset: String(listState.offset)
    });
    if (listState.search) {
      params.set("search", listState.search);
    }
    const data = await jsonFetch(`/admin/lists/${encodeURIComponent(listState.kind)}?${params.toString()}`);
    if (!data) return;
    listState.total = data.pagination.total;
    updateActiveListLabel();
    updateSuggestedKeywordControls();

    if (!data.entries.length && listState.offset === 0) {
      listContent.innerHTML = '<div class="empty-state">Empty list.</div>';
      listState.hasMore = false;
      return;
    }

    appendListRows(data.entries);
    listState.offset += data.entries.length;
    listState.hasMore = data.pagination.hasMore;
    if (!listState.hasMore) {
      appendListEnd(data.pagination.total);
    }
  } finally {
    removeListLoader();
    listState.loading = false;
  }
}

async function refreshList() {
  listState.kind = editKind.value;
  listState.search = listSearch.value.trim();
  listState.offset = 0;
  listState.hasMore = true;
  listState.loading = false;
  listState.total = null;
  clearSelection();
  updateActiveListLabel();
  updateSuggestedKeywordControls();
  listContent.innerHTML = "";
  await loadNextListPage();
  await refreshListSearchMatches();
}

function updateActiveListLabel() {
  const label = currentEditKindLabel();
  const activeTotal = Number(latestListCounts[listState.kind] ?? 0);
  if (listState.search) {
    const matching = listState.total ?? 0;
    activeListLabel.textContent = `List: ${label} - ${matching} matching / ${activeTotal} active lines - search: ${listState.search}`;
    return;
  }
  const total = listState.total ?? activeTotal;
  activeListLabel.textContent = `List: ${label} - ${total} active lines`;
}

async function refreshListSearchMatches() {
  if (!listSearchMatches) return;
  const query = listState.search.trim();
  if (!query) {
    listSearchMatches.innerHTML = "";
    return;
  }

  listSearchMatches.innerHTML = '<div class="list-search-match-note">Searching other lists...</div>';
  const params = new URLSearchParams({ q: query, limit: "6" });
  const result = await jsonFetch(`/admin/lists/search?${params.toString()}`);
  if (!result) return;
  const groups = Array.isArray(result.groups) ? result.groups : [];
  if (!groups.length) {
    listSearchMatches.innerHTML = '<div class="list-search-match-note">No match in any editable list.</div>';
    return;
  }

  const html = groups
    .map((group) => {
      const kind = String(group.kind || "");
      const label = listKindLabel(kind);
      const entries = Array.isArray(group.entries) ? group.entries : [];
      const entryHtml = entries
        .map((entry) => {
          const value = entry.rawValue || "(empty line)";
          const meta = entry.lineNumber ? `line ${entry.lineNumber}` : `#${entry.id}`;
          return `<button class="list-search-match" type="button" data-search-match-kind="${escapeAttribute(kind)}" data-search-match-id="${escapeAttribute(entry.id)}" data-search-match-value="${escapeAttribute(value)}" title="Open ${escapeAttribute(label)} and select this match.">
            <code>${highlightMatch(value, result.query || query)}</code>
            <span>${escapeHtml(meta)}</span>
          </button>`;
        })
        .join("");
      const more = Number(group.total ?? 0) > entries.length ? `<span class="list-search-match-more">+${Number(group.total) - entries.length}</span>` : "";
      return `<section class="list-search-match-group">
        <header><strong>${escapeHtml(label)}</strong><span>${Number(group.total ?? 0)} match${Number(group.total ?? 0) === 1 ? "" : "es"}${more}</span></header>
        <div>${entryHtml}</div>
      </section>`;
    })
    .join("");

  listSearchMatches.innerHTML = `<div class="list-search-match-title">Matches in lists</div>${html}`;
}

function listKindLabel(kind) {
  const option = Array.from(editKind.options).find((item) => item.value === kind);
  return option?.textContent?.trim() || kind;
}

function highlightMatch(value, query) {
  const text = String(value);
  const needle = String(query || "").trim();
  if (!needle) {
    return escapeHtml(text);
  }
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index === -1) {
    return escapeHtml(text);
  }
  return `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(text.slice(index, index + needle.length))}</mark>${escapeHtml(
    text.slice(index + needle.length)
  )}`;
}

async function openListSearchMatch(button) {
  const kind = button.dataset.searchMatchKind;
  const entryId = Number(button.dataset.searchMatchId);
  const value = button.dataset.searchMatchValue || "";
  if (!kind || !Number.isFinite(entryId)) return;
  editKind.value = kind;
  listSearch.value = value;
  listState.pendingEntryId = entryId;
  await refreshList();
  setStatus(`Opened ${listKindLabel(kind)} match: ${value}`);
}

function appendListRows(entries) {
  const html = entries
    .map((entry) => {
      const value = entry.rawValue || "(empty line)";
      const line = entry.lineNumber ? `line ${entry.lineNumber}` : `#${entry.id}`;
      if (entry.kind === "suggested_keyword") {
        return `<div class="list-row list-row-with-actions" data-entry-id="${entry.id}" data-entry-kind="${entry.kind}" data-entry-value="${encodeURIComponent(entry.rawValue)}">
          <button class="list-row-main" type="button" title="Select this suggested keyword so it can be edited or deleted.">
            <code>${escapeHtml(value)}</code>
            <span>${line}</span>
          </button>
          <button class="list-row-action secondary-button" type="button" data-promote-suggested-keyword="${entry.id}" title="Move this suggestion into Keywords and remove it from Suggested keywords.">Add to keywords</button>
        </div>`;
      }
      if (entry.kind === "stale_keyword_user") {
        return `<div class="list-row list-row-with-actions" data-entry-id="${entry.id}" data-entry-kind="${entry.kind}" data-entry-value="${encodeURIComponent(entry.rawValue)}">
          <button class="list-row-main" type="button" title="Select this list entry so it can be edited or deleted.">
            <code>${escapeHtml(value)}</code>
            <span>${line}</span>
          </button>
          <button class="list-row-action secondary-button" type="button" data-restore-stale-keyword-user="${entry.id}" title="Move this user back into Keywords and remove it from Stale keyword users.">Re-enable</button>
        </div>`;
      }
      if (entry.kind === "skipped_keyword_user") {
        const reason = skippedKeywordUserReason(entry);
        return `<div class="list-row list-row-with-actions" data-entry-id="${entry.id}" data-entry-kind="${entry.kind}" data-entry-value="${encodeURIComponent(entry.rawValue)}">
          <button class="list-row-main" type="button" title="Select this skipped user entry so it can be edited or deleted.">
            <code>${escapeHtml(value)}</code>
            <span>${escapeHtml(reason || line)}</span>
          </button>
          <button class="list-row-action secondary-button" type="button" data-move-skipped-keyword-user-to-stale="${entry.id}" title="Move this skipped user into Stale keyword users and remove it from Keywords.">Move to stale</button>
        </div>`;
      }
      return `<button class="list-row" type="button" data-entry-id="${entry.id}" data-entry-kind="${entry.kind}" data-entry-value="${encodeURIComponent(entry.rawValue)}" title="Select this list entry so it can be edited or deleted.">
        <code>${escapeHtml(value)}</code>
        <span>${line}</span>
      </button>`;
    })
    .join("");
  listContent.insertAdjacentHTML("beforeend", html);
  selectPendingListEntryIfVisible();
}

function updateSuggestedKeywordControls() {
  if (!promoteAllSuggestedKeywordsButton) return;
  const isSuggestedKeywordList = listState.kind === "suggested_keyword";
  const total = Number(listState.total ?? latestListCounts.suggested_keyword ?? 0);
  promoteAllSuggestedKeywordsButton.classList.toggle("is-hidden", !isSuggestedKeywordList);
  promoteAllSuggestedKeywordsButton.disabled = !isSuggestedKeywordList || total <= 0;
}

function selectPendingListEntryIfVisible() {
  if (!listState.pendingEntryId) return;
  const row = listContent.querySelector(`.list-row[data-entry-id="${listState.pendingEntryId}"]`);
  if (!row) return;
  selectEntry(row);
  row.scrollIntoView({ block: "nearest" });
  listState.pendingEntryId = null;
}

function renderListLoader() {
  removeListLoader();
  listContent.insertAdjacentHTML("beforeend", '<div id="list-loader" class="list-loader">Loading...</div>');
}

function removeListLoader() {
  const loader = document.getElementById("list-loader");
  if (loader) loader.remove();
}

function appendListEnd(total) {
  if (document.getElementById("list-end")) return;
  listContent.insertAdjacentHTML("beforeend", `<div id="list-end" class="list-loader">End of list - ${total} entries loaded.</div>`);
}

function selectEntry(row) {
  document.querySelectorAll(".list-row.is-selected").forEach((item) => item.classList.remove("is-selected"));
  row.classList.add("is-selected");
  listState.selectedEntry = {
    id: Number(row.dataset.entryId),
    kind: row.dataset.entryKind,
    value: decodeURIComponent(row.dataset.entryValue || "")
  };
  entryValue.value = listState.selectedEntry.value;
  selectedEntryLine.textContent = `Selected entry: #${listState.selectedEntry.id}`;
  saveSelectedButton.disabled = false;
  deleteSelectedButton.disabled = false;
  clearSelectionButton.disabled = false;
}

function clearSelection() {
  document.querySelectorAll(".list-row.is-selected").forEach((item) => item.classList.remove("is-selected"));
  listState.selectedEntry = null;
  selectedEntryLine.textContent = "No entry selected.";
  saveSelectedButton.disabled = true;
  deleteSelectedButton.disabled = true;
  clearSelectionButton.disabled = true;
}

async function restoreStaleKeywordUser(entryId, button) {
  const result = await jsonFetch(`/admin/lists/stale_keyword_user/${encodeURIComponent(entryId)}/restore-keyword`, {
    method: "POST"
  });
  if (!result) return;
  showButtonFeedback(button, "Restored.");
  await refreshStats();
  if (activeAdminSection() === "lists") {
    await refreshList();
  }
  if (activeAdminSection() !== "lists") {
    await refreshStaleKeywordUserPruneStatus();
  }
}

async function moveSkippedKeywordUserToStale(entryId, button) {
  const result = await jsonFetch(`/admin/lists/skipped_keyword_user/${encodeURIComponent(entryId)}/move-to-stale`, {
    method: "POST"
  });
  if (!result) return;
  showButtonFeedback(button, "Moved.");
  await refreshStats();
  if (activeAdminSection() === "lists") {
    await refreshList();
  }
  if (activeAdminSection() !== "lists") {
    await refreshStaleKeywordUserPruneStatus();
  }
}

async function promoteSuggestedKeyword(entryId, button) {
  const result = await jsonFetch(`/admin/lists/suggested_keyword/${encodeURIComponent(entryId)}/promote-keyword`, {
    method: "POST"
  });
  if (!result) return;
  showButtonFeedback(button, "Added.");
  await refreshStats();
  if (activeAdminSection() === "lists") {
    await refreshList();
  }
}

async function promoteAllSuggestedKeywords() {
  if (!promoteAllSuggestedKeywordsButton) return;
  const total = Number(listState.total ?? latestListCounts.suggested_keyword ?? 0);
  const confirmed = window.confirm(`Add ${total} suggested keyword${total === 1 ? "" : "s"} to Keywords?\n\nSuggestions will be removed from Suggested keywords.`);
  if (!confirmed) {
    setStatus("Suggested keyword promotion cancelled.");
    return;
  }
  promoteAllSuggestedKeywordsButton.disabled = true;
  const result = await jsonFetch("/admin/lists/suggested_keyword/promote-all", {
    method: "POST"
  });
  if (!result) {
    updateSuggestedKeywordControls();
    return;
  }
  showButtonFeedback(promoteAllSuggestedKeywordsButton, `Added ${result.promoted ?? 0}.`);
  await refreshStats();
  await refreshList();
}

async function openStaleKeywordUsersList() {
  showAdminSection("lists");
  editKind.value = "stale_keyword_user";
  listSearch.value = "";
  await refreshStats();
  await refreshList();
}

async function openSkippedKeywordUsersList() {
  showAdminSection("lists");
  editKind.value = "skipped_keyword_user";
  listSearch.value = "";
  await refreshStats();
  await refreshList();
}

function skippedKeywordUserReason(entry) {
  const source = String(entry?.sourceFile || "");
  return source.startsWith("reason:") ? source.slice("reason:".length) : "";
}

function formatListCleanupSummary(result) {
  const labels = [
    ["duplicatesDeleted", "duplicates"],
    ["emptyDeleted", "empty"],
    ["keywordBannedWordsDeleted", "keyword/banned words"],
    ["keywordBannedUsersDeleted", "keyword/banned users"],
    ["followingBannedUsersDeleted", "following/banned users"],
    ["friendBannedUsersDeleted", "friends/banned users"],
    ["staleBannedUsersDeleted", "stale/banned users"],
    ["skippedBannedUsersDeleted", "skipped/banned users"],
    ["staleActiveKeywordsDeleted", "stale/active keywords"],
    ["skippedActiveKeywordsDeleted", "skipped/active keywords"],
    ["skippedStaleUsersDeleted", "skipped/stale users"]
  ];
  const parts = labels
    .map(([key, label]) => [Number(result?.[key] ?? 0), label])
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  const total = Number(result?.totalDeleted ?? 0);
  return `List cleanup: ${total} removed${parts.length ? ` (${parts.join(", ")})` : ""}.`;
}

async function cleanupLists() {
  if (!window.confirm("Clean duplicate entries, empty rows, and known conflicts between editable lists?")) {
    return;
  }
  if (cleanupListsButton) cleanupListsButton.disabled = true;
  try {
    const result = await jsonFetch("/admin/lists/maintenance/cleanup", { method: "POST" });
    if (!result) return;
    setStatus(formatListCleanupSummary(result));
    showButtonFeedback(cleanupListsButton, "Cleaned.");
    clearSelection();
    await refreshStats();
    await refreshList();
  } finally {
    if (cleanupListsButton) cleanupListsButton.disabled = false;
  }
}

async function deleteAllSelectedListEntries() {
  const kind = editKind.value;
  const label = editKind.selectedOptions?.[0]?.textContent?.trim() || kind;
  const confirmed = window.confirm(
    `Delete every active entry from ${label}?\n\nThis only marks entries as deleted, but the list will become empty in active use. Continue?`
  );
  if (!confirmed) {
    setStatus("Delete all list cancelled.");
    return;
  }
  if (deleteAllListButton) deleteAllListButton.disabled = true;
  try {
    const result = await jsonFetch(`/admin/lists/${encodeURIComponent(kind)}/all`, { method: "DELETE" });
    if (!result) return;
    setStatus(`Deleted ${result.deleted ?? 0} active entr${result.deleted === 1 ? "y" : "ies"} from ${label}.`);
    showButtonFeedback(deleteAllListButton, "Deleted.");
    clearSelection();
    await refreshStats();
    await refreshList();
  } finally {
    if (deleteAllListButton) deleteAllListButton.disabled = false;
  }
}

function showAdminSection(sectionId) {
  document.querySelectorAll("[data-admin-section-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.adminSectionTarget === sectionId);
  });
  if (adminNavMore) {
    const isMoreSection = moreNavSectionIds.has(sectionId);
    adminNavMore.classList.toggle("is-active", isMoreSection);
    if (isMoreSection) {
      adminNavMore.open = true;
    }
  }
  document.querySelectorAll(".admin-section").forEach((section) => {
    section.classList.toggle("is-active", section.id === `admin-section-${sectionId}`);
  });
  if (window.location.hash !== `#${sectionId}`) {
    window.history.replaceState(null, "", `#${sectionId}`);
  }
  if (sectionId === "settings") {
    refreshStaleKeywordUserPruneStatus().catch((error) => setStatus(error.message));
  }
}

function activeAdminSection() {
  const active = document.querySelector(".admin-section.is-active");
  return active?.id.replace("admin-section-", "") || "session";
}

async function openCurrentSessionSection() {
  showAdminSection("session");
  updateSessionPolling();
  await refreshStats();
  await refreshCurrentSession();
  await refreshSessionKeywords();
  await refreshRunPreview();
}

async function openCurrentSessionForLiveFollow() {
  showAdminSection("session");
  if (sessionAutoRefresh) {
    sessionAutoRefresh.checked = true;
  }
  if (sessionStickBottom) {
    sessionStickBottom.checked = true;
    sessionShouldStickBottom = true;
  }
  updateSessionPolling();
  document.getElementById("admin-section-session")?.scrollIntoView({ block: "start" });
  await refreshCurrentSession();
}

function isActiveRun(run) {
  return run?.status === "running" || run?.status === "paused";
}

function renderRunActionButtons(run) {
  const active = isActiveRun(run);
  document.querySelectorAll("[data-run-action]").forEach((button) => {
    const action = button.dataset.runAction;
    const highlighted =
      action === "start"
        ? !active
        : action === "pause"
          ? run?.status === "running"
          : action === "stop"
            ? true
            : action === "resume"
              ? run?.status === "paused"
              : false;
    button.classList.toggle("is-run-action-active", highlighted);
  });
}

function formatStaleKeywordUserPruneRunLabel(status) {
  if (!status?.running || !status.job) {
    return "";
  }
  const job = status.job;
  const report = job.report;
  const modeLabel = (report?.mode ?? job.mode) === "x_api" ? "X API" : "browser";
  const total = Number(report?.totalCandidates ?? 0);
  const processed = Number(report?.processedCandidates ?? 0);
  const remaining = Math.max(0, total - processed);
  const progress =
    Number.isFinite(total) && total > 0
      ? `${processed}/${total} checked, ${remaining} @ remaining`
      : "waiting for first update";
  return `Inactive users check (${modeLabel}) - ${progress}`;
}

function renderRunStatus(run, staleKeywordUserPrune) {
  if (!runStatusLine) return;
  renderRunActionButtons(run);
  if (!isActiveRun(run)) {
    const pruneLabel = formatStaleKeywordUserPruneRunLabel(staleKeywordUserPrune);
    if (pruneLabel) {
      runStatusLine.textContent = pruneLabel;
      return;
    }
  }
  if (!run) {
    runStatusLine.textContent = "No active run.";
    return;
  }
  const prefix = run.status === "running" || run.status === "paused" ? "Run" : "Last run";
  runStatusLine.textContent = `${prefix} ${run.id} - ${run.status}`;
}

function renderXSessionAlertHeader() {
  const alert = openXSessionAlerts[0];
  const runStartButtons = Array.from(document.querySelectorAll('[data-run-action="start"]'));
  const shouldBlockStart = Boolean(alert && currentRuntimeModes.searchWithoutApiEnabled);
  runStartButtons.forEach((button) => {
    button.disabled = shouldBlockStart;
  });

  if (!xSessionAlertHeader) return;
  if (!alert) {
    xSessionAlertHeader.classList.add("is-hidden");
    if (xSessionAlertNote) xSessionAlertNote.value = "";
    if (xSessionAlertCommands) {
      xSessionAlertCommands.textContent = "";
      xSessionAlertCommands.hidden = false;
    }
    if (xSessionAlertLogin) {
      xSessionAlertLogin.dataset.alertId = "";
      xSessionAlertLogin.disabled = true;
    }
    if (xSessionAlertIgnore) {
      xSessionAlertIgnore.dataset.alertId = "";
      xSessionAlertIgnore.disabled = true;
    }
    updateManualLoginStatus("", "");
    return;
  }

  xSessionAlertHeader.classList.remove("is-hidden");
  if (xSessionAlertTitle) {
    xSessionAlertTitle.textContent = `X manual verification required: ${alert.xIdentifier}`;
  }
  if (xSessionAlertDetail) {
    xSessionAlertDetail.textContent = [
      "RedqueenX stopped browser search and locked this X account.",
      `Cause: ${alert.alertType}.`,
      `IP: ${alert.publicIpv4 || "unknown"}.`,
      "Open Session Alerts for evidence, commands, and resolution."
    ].filter(Boolean).join(" ");
  }
  if (xSessionAlertCommands) {
    xSessionAlertCommands.textContent = "";
    xSessionAlertCommands.hidden = true;
  }
  if (xSessionAlertLogin) {
    xSessionAlertLogin.dataset.alertId = String(alert.id);
    xSessionAlertLogin.disabled = false;
  }
  if (xSessionAlertIgnore) {
    xSessionAlertIgnore.dataset.alertId = String(alert.id);
    xSessionAlertIgnore.disabled = false;
  }
  if (xSessionAlertResolve) {
    xSessionAlertResolve.dataset.alertId = String(alert.id);
  }
  if (!manualLoginPollTimers.has(String(alert.id))) {
    updateManualLoginStatus(String(alert.id), "");
  }
}

function formatXSessionAlertCommands(alert) {
  if (!alert) return "";
  if (currentSearchIsolation() === "docker_vpn") {
    const noVncUrl = xLoginNoVncUrl();
    const tunnelCommand = xLoginSshTunnelCommand();
    return [
      "Terminal fallback:",
      indentBlock(xLoginCommandDisplay(alert.accountId, xLoginAlertArgs()), "  "),
      `  noVNC URL: ${noVncUrl}`,
      "  If RedqueenX runs on a VPS, keep x-login running on the VPS. From your local PC, open a second terminal and run:",
      `  ${tunnelCommand}`,
      "  Replace <user>@<vps-host> with your real SSH login, for example root@your-server.",
      `  Then open locally: ${noVncUrl}`,
      "  docker compose exec worker npm run diagnose:vpn",
      "  docker compose up -d worker",
      "",
      "Admin button:",
      "  Docker mode does not mount the Docker socket in admin. Launch visible X login shows the noVNC command instead of starting a process."
    ].join("\n");
  }
  return [
    "Terminal fallback:",
    "  npm run setup:local",
    `  ${xLoginCommand(alert.accountId, xLoginAlertArgs())}`,
    "  npm run netns:diagnose",
    "  npm run netns:worker",
    "",
    "Admin button:",
    "  Launch visible X login opens Chrome through the VPN namespace and captures/saves the browser session as soon as login is detected."
  ].join("\n");
}

function indentBlock(text, prefix) {
  return String(text)
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

async function resolveCurrentXSessionAlert() {
  const alertId = xSessionAlertResolve?.dataset.alertId;
  const note = xSessionAlertNote?.value?.trim() || "";
  if (!alertId) return;
  await resolveXSessionAlert(alertId, note, xSessionAlertResolve, xSessionAlertNote);
}

async function resolveSelectedXSessionAlert() {
  const alertId = selectedXSessionAlertId;
  const note = sessionAlertDetailNote?.value?.trim() || "";
  if (!alertId) return;
  await resolveXSessionAlert(alertId, note, sessionAlertDetailResolve, sessionAlertDetailNote);
}

async function ignoreCurrentXSessionAlert() {
  const alertId = xSessionAlertIgnore?.dataset.alertId;
  if (!alertId) return;
  await ignoreXSessionAlert(alertId, xSessionAlertIgnore);
}

async function ignoreSelectedXSessionAlert() {
  const alertId = selectedXSessionAlertId || sessionAlertDetailIgnore?.dataset.alertId;
  if (!alertId) return;
  await ignoreXSessionAlert(alertId, sessionAlertDetailIgnore);
}

async function resolveXSessionAlert(alertId, note, feedbackTarget, noteElement) {
  if (note.length < 1) {
    setStatus("Resolution note required before unlocking this X account.");
    noteElement?.focus();
    return;
  }

  const result = await jsonFetch(`/admin/x-session-alerts/${encodeURIComponent(alertId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
  if (!result) return;
  showButtonFeedback(feedbackTarget, "Resolved.");
  setStatus("X session alert resolved. The fresh X browser session was captured by the visible login flow.");
  selectedXSessionAlertId = null;
  if (xSessionAlertNote) xSessionAlertNote.value = "";
  if (sessionAlertDetailNote) sessionAlertDetailNote.value = "";
  await refreshXSessionAlerts();
  await refreshXBrowserAccounts();
  await maybeOfferResumeInterruptedRun({ afterXSessionAlert: true });
}

async function ignoreXSessionAlert(alertId, feedbackTarget) {
  const alert = findXSessionAlert(alertId);
  const label = alert?.xIdentifier || `alert #${alertId}`;
  const confirmed = window.confirm(
    [
      `Ignore X session alert for ${label}?`,
      "",
      "This unlocks the X browser account without saving a fresh session.",
      "Use it only when you are sure the alert is a false positive or the saved session is still usable."
    ].join("\n")
  );
  if (!confirmed) return;

  const result = await jsonFetch(`/admin/x-session-alerts/${encodeURIComponent(alertId)}/ignore`, {
    method: "POST",
    body: JSON.stringify({})
  });
  if (!result) return;
  showButtonFeedback(feedbackTarget, "Ignored.");
  setStatus(`X session alert ignored for ${result.alert?.xIdentifier || label}.`);
  selectedXSessionAlertId = null;
  await refreshXSessionAlerts();
  await refreshXBrowserAccounts();
  await maybeOfferResumeInterruptedRun({ afterXSessionAlert: true });
}

async function maybeOfferResumeInterruptedRun(options = {}) {
  const data = await jsonFetch("/admin/runs/current");
  const run = data?.run;
  if (!run || run.status !== "paused") {
    return;
  }
  const stats = parseRunStats(run.statsJson);
  const remaining = Math.max(0, Number(stats.remainingKeywords ?? 0));
  if (remaining <= 0) {
    return;
  }
  const promptLines = options.afterXSessionAlert
    ? [
        "Recover last session?",
        "",
        "The X alert interrupted the previous without-API session.",
        `Run: ${run.id}`,
        `Progress: ${stats.completedKeywords} / ${stats.totalKeywords}`,
        `Remaining keywords: ${remaining}`,
        "",
        "OK: recover from the saved keyword position.",
        "Cancel: keep the run paused."
      ]
    : [
        "Recover last session?",
        "",
        "The interrupted without-API run is still paused.",
        `Run: ${run.id}`,
        `Progress: ${stats.completedKeywords} / ${stats.totalKeywords}`,
        `Remaining keywords: ${remaining}`,
        "",
        "OK: recover from the saved keyword position.",
        "Cancel: keep the run paused."
      ];
  const shouldResume = window.confirm(promptLines.join("\n"));
  if (shouldResume) {
    await runAction("resume");
  } else {
    setStatus("Last session kept paused.");
    await openCurrentSessionSection();
  }
}

async function launchXSessionAlertLogin(alertId, feedbackTarget) {
  if (!alertId) return;
  updateManualLoginStatus(alertId, "Preparing visible X login...");
  const result = await jsonFetch(`/admin/x-session-alerts/${encodeURIComponent(alertId)}/manual-login`, {
    method: "POST",
    body: JSON.stringify({})
  });
  if (!result) return;
  if (result.manualRequired) {
    showButtonFeedback(feedbackTarget, "Use command.");
    setStatus(result.message || "Run the displayed x-login command from the host shell.");
    await refreshCurrentSession();
    return;
  }
  const message = result.alreadyRunning
    ? `Visible X login is already running for ${result.alert?.xIdentifier || "this alert"}.`
    : `Visible X login launched for ${result.alert?.xIdentifier || "this alert"}.`;
  showButtonFeedback(feedbackTarget, result.alreadyRunning ? "Already running." : "Launched.");
  setStatus(`${message} Solve the X verification in Chrome; RedqueenX will capture and save the session automatically, then you can mark the alert resolved with a note.`);
  pollXSessionAlertLoginStatus(alertId, feedbackTarget);
  await refreshCurrentSession();
}

function updateManualLoginStatus(alertId, message, state = "") {
  const elements = [];
  if (xSessionAlertLogin?.dataset.alertId === String(alertId) || !alertId) {
    elements.push(xSessionAlertLoginStatus);
  }
  if (sessionAlertDetailLogin?.dataset.alertId === String(alertId) || !alertId) {
    elements.push(sessionAlertDetailLoginStatus);
  }
  for (const element of elements) {
    if (!element) continue;
    element.textContent = message;
    element.classList.toggle("is-success", state === "saved" || state === "saved_running" || state === "completed");
    element.classList.toggle("is-error", state === "failed");
  }
}

async function pollXSessionAlertLoginStatus(alertId, feedbackTarget, attempt = 0) {
  const key = String(alertId);
  const previous = manualLoginPollTimers.get(key);
  if (previous) {
    clearTimeout(previous);
  }

  try {
    const status = await jsonFetch(`/admin/x-session-alerts/${encodeURIComponent(alertId)}/manual-login/status`);
    if (!status) return;
    const line = formatManualLoginStatus(status);
    updateManualLoginStatus(alertId, line, status.state);
    if (status.state === "saved") {
      showButtonFeedback(feedbackTarget, "Session saved.");
      setStatus(`${status.alert?.xIdentifier || "X account"} session saved through VPN IP ${status.publicIpv4 || "unknown"}. Add a resolution note, then click Mark resolved.`);
      await refreshXBrowserAccounts();
      await refreshCurrentSession();
      return;
    }
    if (status.state === "failed") {
      showButtonFeedback(feedbackTarget, "Failed.");
      setStatus(`Visible X login failed. Check ${status.logPath || "the login log"} for details.`);
      await refreshCurrentSession();
      return;
    }
    if (status.running || attempt < 3) {
      const timer = setTimeout(() => {
        pollXSessionAlertLoginStatus(alertId, feedbackTarget, attempt + 1).catch((error) => setStatus(error.message));
      }, status.running ? 2000 : 1000);
      manualLoginPollTimers.set(key, timer);
      return;
    }
  } catch (error) {
    updateManualLoginStatus(alertId, error.message || "Unable to read visible X login status.", "failed");
  }
}

function formatManualLoginStatus(status) {
  const ip = status.publicIpv4 ? ` VPN IP: ${status.publicIpv4}.` : "";
  if (status.state === "running") {
    return `Chrome is open through the VPN namespace.${ip} Finish the manual X verification there.`;
  }
  if (status.state === "saved_running") {
    return `Session saved.${ip} Chrome is intentionally still open. Finish the challenge if needed, then close Chrome yourself.`;
  }
  if (status.state === "saved") {
    return `Session saved successfully.${ip} Chrome was closed by the user.`;
  }
  if (status.state === "failed") {
    return `Visible X login failed. ${status.message || ""}`;
  }
  if (status.state === "completed") {
    return `Visible X login process completed.${ip}`;
  }
  return status.message || "Waiting for visible X login status...";
}

async function refreshXSessionAlerts() {
  const data = await jsonFetch("/admin/x-session-alerts");
  if (!data) return;
  openXSessionAlerts = data.alerts || [];
  recentXSessionAlerts = data.recent || [];
  renderXSessionAlertHeader();
  renderSessionAlertsPanel();
}

function renderSessionAlertsPanel() {
  if (!sessionAlertsSummary || !sessionAlertsList) return;
  const selected = selectedXSessionAlertId ? findXSessionAlert(selectedXSessionAlertId) : null;
  if (selectedXSessionAlertId && !selected) {
    selectedXSessionAlertId = null;
  }

  sessionAlertsSummary.innerHTML = `
    <div class="metric"><span>Open alerts</span><strong>${openXSessionAlerts.length}</strong></div>
    <div class="metric"><span>Recent alerts</span><strong>${recentXSessionAlerts.length}</strong></div>
    <div class="metric"><span>Locked accounts</span><strong>${new Set(openXSessionAlerts.map((alert) => alert.accountId)).size}</strong></div>
    <div class="metric"><span>Status</span><strong class="metric-text">${openXSessionAlerts.length ? "manual action required" : "clear"}</strong></div>
  `;

  const alerts = recentXSessionAlerts.length ? recentXSessionAlerts : openXSessionAlerts;
  if (sessionAlertsCount) {
    sessionAlertsCount.textContent = alerts.length ? `${openXSessionAlerts.length} open / ${alerts.length} shown` : "No alerts";
  }

  if (!alerts.length) {
    sessionAlertsList.innerHTML = '<div class="empty-state">No session alerts.</div>';
    renderSelectedSessionAlert(null);
    return;
  }

  const selectedAlert = selected ?? alerts[0];
  selectedXSessionAlertId = selectedAlert.id;
  sessionAlertsList.innerHTML = alerts
    .map((alert) => {
      const selectedClass = alert.id === selectedXSessionAlertId ? " is-selected" : "";
      const statusClass = alert.status === "open" ? " alert-open" : " alert-resolved";
      return `<button class="list-row session-alert-row${selectedClass}${statusClass}" type="button" data-alert-id="${alert.id}">
        <span>
          <strong>${escapeHtml(alert.xIdentifier)}</strong>
          <small>${escapeHtml(alert.alertType)} - ${escapeHtml(alert.status)}</small>
        </span>
        <code>${escapeHtml(formatAlertDate(alert.detectedAt))}</code>
      </button>`;
    })
    .join("");
  renderSelectedSessionAlert(selectedAlert);
}

function renderSelectedSessionAlert(alert) {
  if (!sessionAlertDetail || !sessionAlertDetailResolve) return;
  if (!alert) {
    sessionAlertDetail.innerHTML = '<p class="muted">Select an alert.</p>';
    sessionAlertDetailResolve.disabled = true;
    if (sessionAlertDetailLogin) {
      sessionAlertDetailLogin.disabled = true;
      sessionAlertDetailLogin.dataset.alertId = "";
    }
    if (sessionAlertDetailIgnore) {
      sessionAlertDetailIgnore.disabled = true;
      sessionAlertDetailIgnore.dataset.alertId = "";
    }
    if (sessionAlertDetailNote) sessionAlertDetailNote.value = "";
    updateManualLoginStatus("", "");
    return;
  }
  selectedXSessionAlertId = alert.id;
  const resolved = alert.status !== "open";
  const alertStateLabel = alert.status === "ignored" ? "Ignored X Session Alert" : resolved ? "Resolved X Session Alert" : "Open X Session Alert";
  sessionAlertDetail.innerHTML = `
    <div class="session-alert-card${resolved ? " is-resolved" : ""}">
      <p class="alert-kicker">${alertStateLabel}</p>
      <h2>${escapeHtml(alert.xIdentifier)}</h2>
      <p><strong>Message:</strong> ${escapeHtml(alert.message)}</p>
      <p><strong>Recommendation:</strong> ${escapeHtml(alert.recommendation)}</p>
      ${formatXSessionAlertEvidence(alert)}
      <pre class="alert-command-block">${escapeHtml(formatXSessionAlertCommands(alert))}</pre>
      <dl class="alert-detail-list">
        <div><dt>Alert ID</dt><dd>#${alert.id}</dd></div>
        <div><dt>Type</dt><dd>${escapeHtml(alert.alertType)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(alert.status)}</dd></div>
        <div><dt>VPN profile</dt><dd>${escapeHtml(alert.vpnProfilePath)}</dd></div>
        <div><dt>Detected IP</dt><dd>${escapeHtml(alert.publicIpv4 || "unknown")}</dd></div>
        <div><dt>Detected at</dt><dd>${escapeHtml(formatAlertDate(alert.detectedAt))}</dd></div>
        <div><dt>Resolved at</dt><dd>${escapeHtml(alert.resolvedAt ? formatAlertDate(alert.resolvedAt) : "-")}</dd></div>
        <div><dt>Resolution note</dt><dd>${escapeHtml(alert.resolvedByNote || "-")}</dd></div>
      </dl>
    </div>
  `;
  sessionAlertDetailResolve.dataset.alertId = String(alert.id);
  sessionAlertDetailResolve.disabled = resolved;
  if (sessionAlertDetailLogin) {
    sessionAlertDetailLogin.dataset.alertId = String(alert.id);
    sessionAlertDetailLogin.disabled = resolved;
  }
  if (sessionAlertDetailIgnore) {
    sessionAlertDetailIgnore.dataset.alertId = String(alert.id);
    sessionAlertDetailIgnore.disabled = resolved;
  }
  if (sessionAlertDetailNote) {
    sessionAlertDetailNote.disabled = resolved;
    sessionAlertDetailNote.value = "";
  }
  if (!manualLoginPollTimers.has(String(alert.id))) {
    updateManualLoginStatus(String(alert.id), "");
  }
}

function formatXSessionAlertEvidence(alert) {
  const details = alert?.details || {};
  const hasDetails = Object.keys(details).length > 0;
  if (!hasDetails) {
    return '<div class="alert-evidence"><p><strong>Evidence:</strong> No browser evidence was captured for this alert.</p></div>';
  }
  const signals = Array.isArray(details.detectionSignals) ? details.detectionSignals : [];
  const visibleText = typeof details.visibleText === "string" ? details.visibleText : "";
  const nonTweetVisibleText = typeof details.nonTweetVisibleText === "string" ? details.nonTweetVisibleText : "";
  const htmlSnippet = typeof details.htmlSnippet === "string" ? details.htmlSnippet : "";
  const alertId = String(alert.id);
  return `
    <div class="alert-evidence">
      <p><strong>Evidence captured from Playwright:</strong></p>
      <dl class="alert-detail-list">
        <div><dt>X URL</dt><dd>${escapeHtml(String(details.url || "-"))}</dd></div>
        <div><dt>Page title</dt><dd>${escapeHtml(String(details.title || "-"))}</dd></div>
        <div><dt>Detected reason</dt><dd>${escapeHtml(String(details.reason || "-"))}</dd></div>
        <div><dt>Detection signals</dt><dd>${escapeHtml(signals.length ? signals.join(" | ") : "-")}</dd></div>
        <div><dt>Detection source</dt><dd>${escapeHtml(String(details.detectionTextSource || "page text excluding tweet articles"))}</dd></div>
        <div><dt>Tweet articles</dt><dd>${escapeHtml(String(details.articleCount ?? "-"))}</dd></div>
        <div><dt>Tweet text nodes</dt><dd>${escapeHtml(String(details.tweetTextCount ?? "-"))}</dd></div>
        <div><dt>Snapshot file</dt><dd>${escapeHtml(String(details.snapshotPath || "-"))}</dd></div>
        <div><dt>Body chars</dt><dd>${escapeHtml(String(details.bodyTextLength ?? "-"))}</dd></div>
        <div><dt>HTML chars</dt><dd>${escapeHtml(String(details.htmlLength ?? "-"))}</dd></div>
      </dl>
      <details>
        <summary>Detection text used by the alert</summary>
        <pre class="alert-command-block">${escapeHtml(nonTweetVisibleText || "(empty)")}</pre>
      </details>
      <details>
        <summary>Visible text preview</summary>
        <pre class="alert-command-block">${escapeHtml(visibleText || "(empty)")}</pre>
      </details>
      <details>
        <summary>HTML snippet preview</summary>
        <pre class="alert-command-block">${escapeHtml(htmlSnippet || "(empty)")}</pre>
      </details>
      ${
        details.snapshotPath
          ? `<div class="alert-snapshot-controls">
               <button class="secondary-button" type="button" data-alert-snapshot-id="${escapeAttribute(alertId)}">Open captured snapshot file</button>
               <label class="alert-snapshot-slider">
                 <span>Snapshot height</span>
                 <input type="range" min="220" max="960" step="20" value="${escapeAttribute(alertSnapshotHeightPx)}" data-alert-snapshot-height="${escapeAttribute(alertId)}">
                 <strong data-alert-snapshot-height-value="${escapeAttribute(alertId)}">${escapeHtml(alertSnapshotHeightPx)}px</strong>
               </label>
             </div>
             <pre class="alert-command-block alert-snapshot-output" style="height:${escapeAttribute(alertSnapshotHeightPx)}px" data-alert-snapshot-output="${escapeAttribute(alertId)}">Snapshot file content will appear here.</pre>`
          : ""
      }
    </div>
  `;
}

async function loadXSessionAlertSnapshot(alertId, button) {
  if (!alertId) return;
  const output = sessionAlertDetail?.querySelector(`[data-alert-snapshot-output="${CSS.escape(String(alertId))}"]`);
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Loading snapshot...";
  }
  try {
    const result = await jsonFetch(`/admin/x-session-alerts/${encodeURIComponent(alertId)}/snapshot`);
    if (output) {
      output.textContent = result?.raw || JSON.stringify(result?.snapshot || {}, null, 2);
      output.scrollTop = 0;
      output.style.height = `${alertSnapshotHeightPx}px`;
    }
    setStatus(`Loaded X session alert snapshot: ${result?.path || "snapshot"}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "Open captured snapshot file";
    }
  }
}

function updateAlertSnapshotHeight(alertId, height) {
  const numericHeight = Math.max(220, Math.min(960, Number(height) || 360));
  alertSnapshotHeightPx = numericHeight;
  const output = sessionAlertDetail?.querySelector(`[data-alert-snapshot-output="${CSS.escape(String(alertId))}"]`);
  const value = sessionAlertDetail?.querySelector(`[data-alert-snapshot-height-value="${CSS.escape(String(alertId))}"]`);
  if (output) {
    output.style.height = `${numericHeight}px`;
  }
  if (value) {
    value.textContent = `${numericHeight}px`;
  }
}

function findXSessionAlert(alertId) {
  const numericId = Number(alertId);
  return recentXSessionAlerts.find((alert) => alert.id === numericId) ?? openXSessionAlerts.find((alert) => alert.id === numericId) ?? null;
}

function formatAlertDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

async function refreshCurrentSession() {
  const previousScrollTop = sessionLog.scrollTop;
  const params = new URLSearchParams({
    limit: "5000",
    level: currentSessionLevel(),
    includeAdminPolling: sessionIncludeAdminPolling.checked ? "true" : "false",
    includeTweetContent: sessionTweetContent.checked ? "true" : "false",
    includeTweetScore: sessionTweetScore.checked ? "true" : "false",
    includeTweetFavoriteCount: sessionTweetFavorites.checked ? "true" : "false",
    includeTweetRetweetCount: sessionTweetRetweets.checked ? "true" : "false"
  });
  const data = await jsonFetch(`/admin/session/current?${params.toString()}`);
  if (!data) return;
  currentRuntimeModes = data.runtimeModes || currentRuntimeModes;
  openXSessionAlerts = data.xSessionAlerts || openXSessionAlerts;
  renderXSessionAlertHeader();

  const run = data.currentRun;
  const stats = parseRunStats(run?.statsJson);
  renderRunStatus(run, data.staleKeywordUserPrune);
  applySessionModeLabels(data.runtimeModes);
  const pruneRunLabel = !isActiveRun(run) ? formatStaleKeywordUserPruneRunLabel(data.staleKeywordUserPrune) : "";
  sessionRunStatus.textContent = pruneRunLabel || (run ? `${run.status} - ${run.id}` : "No active run");
  sessionFilePath.textContent = data.session.filePath;
  sessionUpdatedAt.textContent = data.session.updatedAt
    ? new Date(data.session.updatedAt).toLocaleString()
    : "Never";
  sessionCurrentKeyword.textContent = currentKeywordLabel(run, stats);
  sessionKeywordProgress.textContent = formatSessionKeywordProgress(stats, data.runtimeModes);
  renderSessionStaleKeywordUserPrune(data.staleKeywordUserPrune);
  currentSessionStats = stats;
  sessionAcceptedTweets.textContent = `${stats.acceptedTweets} OK / ${stats.rejectedTweets} rejected`;
  setSessionNextReset(stats.browserAlertAutoRestartAt || stats.nextApiResetAt, data.runtimeModes);
  sessionLog.textContent = data.session.lines.length
    ? data.session.lines.join("\n")
    : "No runtime event.";
  if (sessionShouldStickBottom || sessionStickBottom?.checked) {
    sessionLog.scrollTop = sessionLog.scrollHeight;
  } else {
    sessionLog.scrollTop = Math.min(previousScrollTop, sessionLog.scrollHeight);
  }
}

function renderSessionStaleKeywordUserPrune(status) {
  const running = Boolean(status?.running);
  const restartPending = staleKeywordUserAutoRestartPending(status?.job);
  if (pruneStaleKeywordUsersButton) pruneStaleKeywordUsersButton.disabled = running || restartPending;
  if (stopStaleKeywordUsersButton) stopStaleKeywordUsersButton.disabled = false;
  if (!sessionStalePruneStatus) return;
  const job = status?.job;
  if (!job) {
    sessionStalePruneStatus.textContent = "-";
    sessionStalePruneStatus.removeAttribute("title");
    return;
  }
  const report = job.report;
  const estimate = staleKeywordUserPruneEstimate(status, job);
  const progressSnapshot = staleKeywordUserProgressSnapshot(report, job, estimate);
  const total = progressSnapshot.total;
  const processed = progressSnapshot.processed;
  const remaining = progressSnapshot.remaining;
  const kept = report?.keptUsers?.length ?? 0;
  const skipped = report?.skippedUsers?.length ?? 0;
  const state = report?.status ?? job.status ?? "running";
  const age = Number(job.maxAgeDays ?? report?.maxAgeDays ?? 0);
  const ageLabel = Number.isFinite(age) && age > 0 ? `>${age}d` : "";
  const mode = report?.mode ?? job.mode ?? (currentRuntimeModes.searchWithoutApiEnabled ? "without_api" : "x_api");
  const modeLabel = mode === "x_api" ? " x_api" : " browser";
  const retryLabel = mode === "without_api" && job.autoIgnoreAlert ? " auto-ignore" : "";
  const autoRestartDelaySeconds = Number(job.autoRestartDelaySeconds ?? 0);
  const startIndex = Number(job.startIndex ?? report?.startIndex ?? 1);
  const estimatedChecked = Number(job.estimatedCheckedUsers ?? 0);
  const suggestedStartIndex = Number(job.suggestedStartIndex ?? 1);
  const actionDelayMinSeconds = Math.max(0, Math.floor(Number(job.actionDelayMinSeconds ?? report?.actionDelayMinSeconds ?? 0)));
  const actionDelayMaxSeconds = Math.max(
    actionDelayMinSeconds,
    Math.floor(Number(job.actionDelayMaxSeconds ?? report?.actionDelayMaxSeconds ?? actionDelayMinSeconds))
  );
  const speedLabel = staleKeywordUserSpeedSummary(actionDelayMinSeconds, actionDelayMaxSeconds);
  const startLabel = Number.isFinite(startIndex) && startIndex > 1 ? `, start index ${startIndex}` : "";
  const estimateLabel =
    Number.isFinite(estimatedChecked) && estimatedChecked > 0
      ? `, estimated checked ${estimatedChecked}, next index ${suggestedStartIndex}`
      : "";
  const nextLabel = Number.isFinite(suggestedStartIndex) && suggestedStartIndex > 1 ? `next ${suggestedStartIndex}` : "";
  const restartCountdown = staleKeywordUserAutoRestartCountdownText(job);
  const restartCountdownLabel = restartCountdown ? `restart in ${restartCountdown}` : "";
  const shortParts = [
    state,
    ageLabel,
    modeLabel.trim(),
    retryLabel,
    total > 0 ? `${processed}/${total} checked` : "waiting",
    remaining > 0 ? `${remaining} left` : "",
    nextLabel,
    restartCountdownLabel
  ].filter(Boolean);
  const autoRestartDelayLabel =
    mode === "without_api" && job.autoIgnoreAlert ? `, auto-restart pause ${autoRestartDelaySeconds}s` : "";
  const restartCountdownFullLabel = restartCountdown ? `, auto-restart in ${restartCountdown}` : "";
  const fullStatus = `${state} ${ageLabel}${modeLabel}${retryLabel ? ` ${retryLabel}` : ""}${autoRestartDelayLabel}${restartCountdownFullLabel}${startLabel}${estimateLabel} - speed ${speedLabel} - ${processed}/${total} checked, ${remaining} left, ${kept} kept, ${skipped} skipped`;
  if (!report && state === "running") {
    sessionStalePruneStatus.textContent = shortParts.join(" - ");
    sessionStalePruneStatus.title = `running ${ageLabel}${modeLabel}${retryLabel ? ` ${retryLabel}` : ""}${autoRestartDelayLabel}${startLabel}${estimateLabel} - speed ${speedLabel} - waiting for first update`;
    return;
  }
  sessionStalePruneStatus.textContent = shortParts.join(" - ");
  sessionStalePruneStatus.title = fullStatus;
}

function setSessionNextReset(value, runtimeModes = {}) {
  sessionNextResetAt = value ? Date.parse(value) : null;
  if (sessionNextResetLabel && runtimeModes.searchWithoutApiEnabled && currentSessionStats?.browserAlertAutoRestartAt) {
    sessionNextResetLabel.textContent = "Alert auto restart";
  }
  renderSessionTimers(runtimeModes);
  if (sessionNextResetTimer) {
    clearInterval(sessionNextResetTimer);
    sessionNextResetTimer = null;
  }
  if (sessionNextResetAt && Number.isFinite(sessionNextResetAt)) {
    sessionNextResetTimer = setInterval(() => renderSessionTimers(currentRuntimeModes), 1000);
  }
}

function renderSessionTimers(runtimeModes = currentRuntimeModes) {
  if (sessionApiLeft && currentSessionStats) {
    sessionApiLeft.textContent = formatSearchesBeforePause(currentSessionStats, runtimeModes);
  }
  renderSessionNextReset(runtimeModes);
}

function renderSessionNextReset(runtimeModes = currentRuntimeModes) {
  if (!sessionNextReset) return;
  if (!sessionNextResetAt || !Number.isFinite(sessionNextResetAt)) {
    sessionNextReset.textContent = "-";
    return;
  }
  const remainingMs = sessionNextResetAt - Date.now();
  const dateText = new Date(sessionNextResetAt).toLocaleString();
  if (remainingMs <= 0) {
    sessionNextReset.textContent = runtimeModes.searchWithoutApiEnabled ? "Resuming now..." : `Due now (${dateText})`;
    return;
  }
  const seconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  const countdown = `${minutes}:${String(restSeconds).padStart(2, "0")}`;
  sessionNextReset.textContent = runtimeModes.searchWithoutApiEnabled
    ? `${countdown} remaining - ${dateText}`
    : `${dateText} (${countdown})`;
}

async function refreshSessionKeywords() {
  if (!sessionKeywordsList || !sessionKeywordsSummary) return;
  const data = await jsonFetch("/admin/session/keywords?limit=1000");
  if (!data?.run) {
    sessionKeywordsSummary.textContent = "No run loaded.";
    sessionKeywordsList.innerHTML = '<div class="empty-state">Start a run to load a keyword plan.</div>';
    return;
  }
  const loadedLabel = data.loaded > 0 ? `${data.loaded} shown` : "0 persisted";
  const runScope = data.run.isCurrent ? "active run" : `latest ${data.run.status} run`;
  const chain = data.chain || {};
  const chainParts = [];
  if (Number(chain.total) > 1) {
    chainParts.push(`run ${chain.index}/${chain.total}`);
  }
  if (Number(chain.queuedKeywords) > 0) {
    chainParts.push(`${chain.queuedKeywords} queued next`);
  }
  const chainLabel = chainParts.length ? ` - ${chainParts.join(" - ")}` : "";
  sessionKeywordsSummary.textContent = `${loadedLabel} / ${data.total} planned - ${runScope} ${data.run.id}${chainLabel}`;
  if (!data.keywords.length) {
    sessionKeywordsList.innerHTML =
      data.total > 0
        ? '<div class="empty-state">Keyword plan is queued but no keyword rows have been written yet. Refresh after the Docker worker starts.</div>'
        : '<div class="empty-state">No keywords are planned for this run. All active keywords may already be in SearchTerms.Used or No.Result; clear one of those lists before starting another search.</div>';
    return;
  }
  sessionKeywordsList.innerHTML = data.keywords
    .map((item) => `<div class="session-keyword-row is-${escapeAttribute(item.status)}">
      <span>#${escapeHtml(item.position)}</span>
      <strong>${escapeHtml(item.keyword)}</strong>
      <em>${escapeHtml(item.status)}</em>
    </div>`)
    .join("");
}

async function refreshRunPreview() {
  if (!runPreviewList || !runPreviewSummary) return;
  const data = await jsonFetch("/admin/runs/preview");
  if (!data) return;
  const availability = data.availability || {};
  const previews = Array.isArray(data.previews)
    ? data.previews
    : [{ runIndex: 1, plannedKeywords: data.plannedKeywords ?? 0, sample: Array.isArray(data.sample) ? data.sample : [] }];
  const previewLabel =
    data.source === "active_run"
      ? `${previews.length} active run${previews.length === 1 ? "" : "s"}`
      : `${previews.length} fresh run preview${previews.length === 1 ? "" : "s"}`;
  runPreviewSummary.textContent = [
    previewLabel,
    `${availability.availableKeywords ?? 0} available now`,
    `${availability.excludedBySearchTermsUsed ?? 0} already searched`,
    `${availability.excludedByNoResult ?? 0} no-result excluded`
  ].join(" - ");
  if (!previews.some((preview) => Array.isArray(preview.sample) && preview.sample.length > 0)) {
    runPreviewList.innerHTML =
      data.source === "active_run"
        ? '<div class="empty-state">Active run has no keyword rows loaded.</div>'
        : '<div class="empty-state">No eligible keyword for the next run. SearchTerms.Used and/or No.Result currently exclude every active keyword.</div>';
    return;
  }
  runPreviewList.innerHTML = previews
    .map((preview) => renderRunPreviewPanel(preview))
    .join("");
}

function renderRunPreviewPanel(preview) {
  const runIndex = String(preview.runIndex ?? 1);
  const keywords = Array.isArray(preview.sample) ? preview.sample : [];
  const plannedCount = Number.isFinite(Number(preview.plannedKeywords)) ? Number(preview.plannedKeywords) : keywords.length;
  const status = preview.status === "active" ? "active" : preview.status === "queued" ? "queued" : "planned";
  const isOpen = runPreviewOpenState.has(runIndex);
  const rows = keywords.length
    ? keywords
        .map((keyword, index) => `<div class="session-keyword-row">
          <span>#${index + 1}</span>
          <strong>${escapeHtml(keyword)}</strong>
          <em>${escapeHtml(status)}</em>
        </div>`)
        .join("")
    : '<div class="empty-state">No eligible keyword left for this run preview.</div>';
  return `<details class="run-preview-panel" data-run-preview-index="${escapeAttribute(runIndex)}"${isOpen ? " open" : ""}>
    <summary>
      <strong>Run ${escapeHtml(runIndex)} - ${escapeHtml(status)}</strong>
      <span>${escapeHtml(String(plannedCount))} planned</span>
    </summary>
    <div class="session-keywords-list">${rows}</div>
  </details>`;
}

function updateSessionStickStateFromScroll() {
  if (!sessionLog) return;
  sessionShouldStickBottom = isSessionLogNearBottom();
  if (sessionStickBottom) {
    sessionStickBottom.checked = sessionShouldStickBottom;
  }
}

function isSessionLogNearBottom() {
  return sessionLog.scrollHeight - sessionLog.scrollTop - sessionLog.clientHeight <= 48;
}

async function refreshBrowserSnapshots() {
  const data = await jsonFetch("/admin/browser-snapshots");
  if (!data) return;
  browserSnapshotRuns = data.runs || [];
  renderBrowserSnapshotList();
}

function renderBrowserSnapshotList() {
  if (!browserSnapshotsList || !browserSnapshotsCount) return;
  const snapshots = flattenBrowserSnapshots();
  browserSnapshotsCount.textContent = snapshots.length
    ? `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} available`
    : "No snapshots available.";
  if (!snapshots.length) {
    browserSnapshotsList.innerHTML = '<div class="empty-state">Run a smoke test or browser search to capture snapshots.</div>';
    if (browserSnapshotMeta) browserSnapshotMeta.textContent = "Select a snapshot.";
    if (browserSnapshotFullText) browserSnapshotFullText.textContent = "Full snapshot text will appear here.";
    selectedBrowserSnapshot = null;
    return;
  }

  browserSnapshotsList.innerHTML = snapshots
    .map((snapshot) => {
      const selected =
        selectedBrowserSnapshot?.runId === snapshot.runId && selectedBrowserSnapshot?.filename === snapshot.filename
          ? " is-selected"
          : "";
      return `<button class="list-row snapshot-row${selected}" type="button" data-run-id="${escapeAttribute(
        snapshot.runId
      )}" data-filename="${escapeAttribute(snapshot.filename)}">
        <span>
          <strong>${escapeHtml(snapshot.keyword || "unknown keyword")}</strong>
          <small>${escapeHtml(snapshot.phase || "snapshot")} - ${escapeHtml(snapshot.title || "untitled")}</small>
        </span>
        <code>${escapeHtml(formatSnapshotSize(snapshot))}</code>
      </button>`;
    })
    .join("");
}

function flattenBrowserSnapshots() {
  return browserSnapshotRuns.flatMap((run) =>
    (run.files || [])
      .filter((file) => file.phase !== "before_search")
      .map((file) => ({ ...file, runId: run.runId }))
  );
}

function formatSnapshotSize(snapshot) {
  const chars = Number(snapshot.bodyTextLength || 0).toLocaleString();
  return `${chars} chars / ${formatBytes(snapshot.sizeBytes)}`;
}

async function selectBrowserSnapshot(runId, filename) {
  const snapshot = await jsonFetch(`/admin/browser-snapshots/${encodeURIComponent(runId)}/${encodeURIComponent(filename)}`);
  if (!snapshot) return;
  selectedBrowserSnapshot = { runId, filename };
  renderBrowserSnapshotList();
  if (browserSnapshotMeta) {
    browserSnapshotMeta.innerHTML = `
      <strong>${escapeHtml(snapshot.keyword || "unknown keyword")}</strong>
      <span>${escapeHtml(snapshot.phase || "snapshot")}</span>
      <span>${escapeHtml(snapshot.capturedAt ? new Date(snapshot.capturedAt).toLocaleString() : "unknown date")}</span>
      <span>${escapeHtml(snapshot.articleCount ?? 0)} tweet articles / ${escapeHtml(snapshot.tweetTextCount ?? 0)} tweet text nodes</span>
      <span>${escapeHtml(snapshot.path || "")}</span>
    `;
  }
  if (browserSnapshotFullText) {
    browserSnapshotFullText.textContent = snapshot.bodyText || "(empty)";
    browserSnapshotFullText.scrollTop = 0;
  }
}

async function runAdminTest(testName, button) {
  if (!testName || !adminTestOutput) return;
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Running...";
  }
  adminTestOutput.textContent = `Running ${testName}...\n`;
  try {
    const result = await jsonFetch("/admin/tests/run", {
      method: "POST",
      body: JSON.stringify({ test: testName })
    });
    const output = formatAdminTestOutput(result);
    adminTestOutput.textContent = output;
    adminTestOutput.scrollTop = 0;
    setStatus(`${result.label || testName}: ${result.ok ? "completed" : "failed"}`);
  } catch (error) {
    adminTestOutput.textContent = error.message;
    setStatus(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
    refreshCurrentSessionSoon();
  }
}

function formatAdminTestOutput(result) {
  const lines = [
    `${result.ok ? "PASSED" : "FAILED"}: ${result.label || result.test}`,
    `Command: ${result.command || "-"}`
  ];
  if (result.description) {
    lines.push(`Info: ${result.description}`);
  }
  lines.push("");
  if (result.error) {
    lines.push("ERROR", result.error, "");
  }
  if (result.stdout) {
    lines.push("STDOUT", result.stdout.trimEnd(), "");
  }
  if (result.stderr) {
    lines.push("STDERR", result.stderr.trimEnd(), "");
  }
  if (!result.stdout && !result.stderr) {
    lines.push("No output returned.");
  }
  return lines.join("\n");
}

async function toggleSessionFullscreen() {
  if (!sessionLog || !document.fullscreenEnabled) {
    setStatus("Fullscreen is not available in this browser.");
    return;
  }
  if (document.fullscreenElement === sessionLog) {
    await document.exitFullscreen();
  } else {
    await sessionLog.requestFullscreen();
  }
}

function applySessionModeLabels(runtimeModes = {}) {
  if (runtimeModes.searchWithoutApiEnabled) {
    sessionApiLeftLabel.textContent = "Searches before pause";
    sessionNextResetLabel.textContent = "Next search window";
    return;
  }

  sessionApiLeftLabel.textContent = "API before pause";
  sessionNextResetLabel.textContent = "Next API window";
}

function parseRunStats(statsJson) {
  const defaults = {
    currentKeyword: null,
    totalKeywords: 0,
    completedKeywords: 0,
    remainingKeywords: 0,
    availableKeywords: null,
    sessionKeywordLimit: null,
    sessionKeywordLimitRandom: false,
    randomizeKeywordOrder: false,
    apiCallsUsed: 0,
    apiCallLimit: 0,
    apiCallsRemaining: 0,
    apiWindowMinutes: 0,
    nextApiResetAt: null,
    browserAlertAutoIgnore: false,
    browserAlertRetryCount: 0,
    browserAlertMaxRetries: 0,
    browserAlertAutoRestartDelaySeconds: 0,
    browserAlertAutoRestartAt: null,
    browserAlertLastCompletedKeywords: null,
    acceptedTweets: 0,
    rejectedTweets: 0,
    lastScore: null,
    lastTweetId: null
  };
  if (!statsJson) return defaults;
  try {
    return { ...defaults, ...JSON.parse(statsJson) };
  } catch {
    return defaults;
  }
}

function formatSearchesBeforePause(stats, runtimeModes = {}) {
  if (!runtimeModes.searchWithoutApiEnabled) {
    return `${stats.apiCallsRemaining} / ${stats.apiCallLimit}`;
  }
  if (stats.browserAlertAutoRestartAt) {
    return `alert retry ${stats.browserAlertRetryCount ?? 0} / ${stats.browserAlertMaxRetries ?? 0}`;
  }
  const completedInWindow = Math.max(0, Number(stats.apiCallsUsed ?? 0));
  const limit = Math.max(0, Number(stats.apiCallLimit ?? 0));
  const remaining = Math.max(0, Number(stats.apiCallsRemaining ?? Math.max(0, limit - completedInWindow)));
  if (remaining <= 0 && stats.nextApiResetAt) {
    const resetAt = Date.parse(stats.nextApiResetAt);
    if (Number.isFinite(resetAt)) {
      const remainingMs = resetAt - Date.now();
      return remainingMs > 0 ? `${remaining} / ${limit} - pause ${formatShortCountdown(remainingMs)}` : `${remaining} / ${limit} - resuming`;
    }
  }
  return `${remaining} / ${limit}`;
}

function formatShortCountdown(remainingMs) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${minutes}:${String(restSeconds).padStart(2, "0")}`;
}

function formatSessionKeywordProgress(stats) {
  return `${stats.completedKeywords} / ${stats.totalKeywords} (${stats.remainingKeywords} remaining)`;
}

function currentKeywordLabel(run, stats) {
  if (stats.currentKeyword) {
    return stats.currentKeyword;
  }
  if (!run) {
    return "No active run";
  }
  if (run.status === "paused") {
    return "Paused";
  }
  if (run.status === "running") {
    return "Waiting for the next keyword";
  }
  return "No keyword in progress";
}

function updateSessionPolling() {
  if (sessionRefreshTimer) {
    clearInterval(sessionRefreshTimer);
    sessionRefreshTimer = null;
  }

  if (activeAdminSection() === "session" && sessionAutoRefresh.checked) {
    sessionRefreshTimer = setInterval(() => {
      refreshCurrentSession().catch((error) => setStatus(error.message));
      refreshSessionKeywords().catch((error) => setStatus(error.message));
      refreshRunPreview().catch((error) => setStatus(error.message));
    }, 2000);
  }
}

function currentSessionLevel() {
  return sessionLevelOptions.find((input) => input.checked)?.dataset.sessionLevel || "debug";
}

function selectSessionLevel(selectedInput) {
  sessionLevelOptions.forEach((input) => {
    input.checked = input === selectedInput;
  });
}

function refreshCurrentSessionSoon() {
  refreshCurrentSession().catch((error) => setStatus(error.message));
  refreshSessionKeywords().catch((error) => setStatus(error.message));
  refreshRunPreview().catch((error) => setStatus(error.message));
}

function currentEditKindLabel() {
  return editKind.options[editKind.selectedIndex]?.textContent || editKind.value;
}

function downloadActiveList() {
  const kind = editKind.value;
  if (!kind) return;
  window.location.href = `/admin/lists/${encodeURIComponent(kind)}/export`;
}

function downloadTimelineTweets() {
  window.location.href = "/admin/timeline/export";
}

function inferKindFromFilename(filename) {
  const baseName = filename.split(/[\\/]/).pop() || filename;
  return legacyKindByFilename.get(baseName) || legacyKindByFilename.get(baseName.replace(/\.txt$/i, "")) || null;
}

function countLegacyLines(content) {
  if (content.length === 0) {
    return 0;
  }

  let count = 0;
  let start = 0;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === "\n" || char === "\r") {
      count += 1;
      if (char === "\r" && content[i + 1] === "\n") {
        i += 1;
      }
      start = i + 1;
    }
  }

  if (start < content.length) {
    count += 1;
  }

  return count;
}

function pickVisibleKind(importResult) {
  const firstFile = importResult.files[0];
  if (!firstFile) return null;
  if (editableKinds.has(firstFile.kind)) return firstFile.kind;
  const derived = firstFile.derived?.find((item) => editableKinds.has(item.kind));
  return derived?.kind || null;
}

function countImportedLines(importResult) {
  return importResult.files.reduce((sum, file) => {
    const derived = (file.derived || []).reduce((derivedSum, item) => derivedSum + item.importedLines, 0);
    return sum + file.importedLines + derived;
  }, 0);
}

function selectedImportFiles() {
  return Array.from(importLocalFile.files || []);
}

async function readSelectedImportFiles() {
  const files = selectedImportFiles();
  if (!files.length) {
    return [];
  }

  const imports = [];
  for (const file of files) {
    const inferredKind = inferKindFromFilename(file.name);
    const kind = inferredKind || importKind.value;
    const content = await file.text();
    imports.push({
      filename: file.name,
      kind,
      content,
      totalLines: countLegacyLines(content)
    });
  }

  return imports;
}

async function savePendingImports() {
  if (!pendingImports.length) {
    setStatus("Import one or more files first.");
    return null;
  }

  const results = [];
  for (const pendingImport of pendingImports) {
    const result = await jsonFetch("/admin/import/content", {
      method: "POST",
      body: JSON.stringify({
        filename: pendingImport.filename,
        kind: pendingImport.kind,
        content: pendingImport.content
      })
    });
    if (!result) return null;
    results.push(result);
  }

  return results;
}

function countImportedLinesFromResults(results) {
  return results.reduce((sum, result) => sum + countImportedLines(result), 0);
}

function pickVisibleKindFromResults(results) {
  for (const result of [...results].reverse()) {
    const kind = pickVisibleKind(result);
    if (kind) return kind;
  }
  return null;
}

async function refreshScoringSettings() {
  const data = await jsonFetch("/admin/settings/scoring");
  if (!data) return;

  scoringForm.elements.allowedLanguages.value = data.config.allowedLanguages.join(", ");
  for (const field of scoringNumberFields) {
    scoringForm.elements[field].value = String(data.config[field]);
  }
  for (const field of scoringBooleanFields) {
    if (scoringForm.elements[field]) {
      scoringForm.elements[field].checked = data.config[field] !== false;
    }
  }
  applyScoringCheckUi();
}

async function refreshTimelineUsers() {
  if (!timelineUsersList) return;
  const data = await jsonFetch("/admin/timeline-users");
  if (!data) return;
  timelineUsers = Array.isArray(data.users) ? data.users : [];
  renderTimelineUsers();
}

function renderTimelineUsers() {
  if (!timelineUsersList) return;
  const selectedId = Number(timelineUserId?.value || 0);
  timelineUsersList.innerHTML = timelineUsers.length
    ? timelineUsers
      .map((user) => {
        const selected = selectedId === user.id ? " is-selected" : "";
        return `<button type="button" class="list-entry-row${selected}" data-timeline-user-id="${user.id}">
          <span>${escapeHtml(user.username)}</span>
          <small>${escapeHtml(user.updatedAt || user.createdAt || "")}</small>
        </button>`;
      })
      .join("")
    : '<p class="muted">No timeline user yet.</p>';
}

function clearTimelineUserForm() {
  if (timelineUserId) timelineUserId.value = "";
  if (timelineUserUsername) timelineUserUsername.value = "";
  if (timelineUserPassword) timelineUserPassword.value = "";
  if (timelineUserDelete) timelineUserDelete.disabled = true;
  renderTimelineUsers();
}

function selectTimelineUser(userId) {
  const user = timelineUsers.find((item) => item.id === Number(userId));
  if (!user) {
    clearTimelineUserForm();
    return;
  }
  if (timelineUserId) timelineUserId.value = String(user.id);
  if (timelineUserUsername) timelineUserUsername.value = user.username;
  if (timelineUserPassword) timelineUserPassword.value = "";
  if (timelineUserDelete) timelineUserDelete.disabled = false;
  if (timelineUsersStatus) timelineUsersStatus.textContent = `Editing ${user.username}.`;
  renderTimelineUsers();
}

async function saveTimelineUser() {
  const id = Number(timelineUserId?.value || 0);
  const username = timelineUserUsername?.value?.trim() || "";
  const password = timelineUserPassword?.value || "";
  if (!username) {
    if (timelineUsersStatus) timelineUsersStatus.textContent = "Username is required.";
    return;
  }
  if (!id && password.length < 8) {
    if (timelineUsersStatus) timelineUsersStatus.textContent = "Password must contain at least 8 characters.";
    return;
  }
  const result = await jsonFetch(id ? `/admin/timeline-users/${id}` : "/admin/timeline-users", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(id ? { username, password } : { username, password })
  });
  if (!result) return;
  if (timelineUsersStatus) timelineUsersStatus.textContent = `Saved ${result.user.username}.`;
  clearTimelineUserForm();
  await refreshTimelineUsers();
}

async function deleteTimelineUser() {
  const id = Number(timelineUserId?.value || 0);
  if (!id) return;
  const username = timelineUserUsername?.value || "this user";
  if (!window.confirm(`Delete timeline access for ${username}?`)) {
    return;
  }
  const result = await jsonFetch(`/admin/timeline-users/${id}`, { method: "DELETE" });
  if (!result) return;
  if (timelineUsersStatus) timelineUsersStatus.textContent = `Deleted ${username}.`;
  clearTimelineUserForm();
  await refreshTimelineUsers();
}

function applyScoringCheckUi() {
  for (const [toggleField, targetField] of Object.entries(scoringCheckTargets)) {
    const toggle = scoringForm.elements[toggleField];
    const target = scoringForm.elements[targetField];
    if (!toggle || !target) continue;
    target.disabled = !toggle.checked;
    target.closest(".scoring-field")?.classList.toggle("is-check-disabled", !toggle.checked);
  }
}

async function refreshServerAccessSettings() {
  const data = await jsonFetch("/admin/settings/server-access");
  if (!data) return;

  writeServerAccessForm(data.config, data.currentIp);
  if (data.disabled && serverAccessDisabledNote) {
    serverAccessDisabledNote.textContent =
      data.disabledReason || "Client certificate authentication is active. IPv4 whitelist and blacklist are ignored in this mode.";
  }
  applyAdminAuthModeUi();
}

async function refreshEnvSettings() {
  const data = await jsonFetch("/admin/env");
  if (!data) return;

  writeEnvForm(data.values, data.redactedKeys);
  applyAdminAuthModeUi();
}

async function refreshXApiSettings() {
  const data = await jsonFetch("/admin/settings/x-api");
  if (!data) return;

  writeXApiForm(data.values, data.redactedKeys);
  writeGeneralSettingsForm(data.values);
  writeSearchWithoutApiForm(data.values);
  applyRuntimeModeUi();
  applyAdminAuthModeUi();
  await refreshOpenVpnProfiles(data.values?.VPN_CONFIG);
}

function writeEnvForm(values, redactedKeys = []) {
  const redacted = new Set(redactedKeys || []);
  for (const field of envFields) {
    const input = envForm.elements[field];
    if (input) {
      input.dataset.redacted = redacted.has(field) ? "true" : "";
      if (input.type === "checkbox") {
        input.checked = values[field] === "true";
      } else {
        input.value = values[field] ?? "";
        if (redacted.has(field)) {
          input.placeholder = "Stored secret (leave blank to keep)";
        }
      }
    }
  }
  applyAdminAuthModeUi();
}

function writeXApiForm(values, redactedKeys = []) {
  const redacted = new Set(redactedKeys || []);
  for (const field of xApiFields) {
    const input = xApiForm.elements[field];
    if (input) {
      input.dataset.redacted = redacted.has(field) ? "true" : "";
      if (input.type === "checkbox") {
        input.checked = values[field] === "true";
      } else {
        input.value = values[field] ?? "";
        if (redacted.has(field)) {
          input.placeholder = "Stored secret (leave blank to keep)";
        }
      }
    }
  }
}

function writeSearchWithoutApiForm(values) {
  for (const field of searchWithoutApiFields) {
    if (searchWithoutApiForm.elements[field]) {
      if (searchWithoutApiForm.elements[field].type === "checkbox") {
        searchWithoutApiForm.elements[field].checked = values[field] === "true";
      } else {
        searchWithoutApiForm.elements[field].value = values[field] ?? "";
      }
    }
  }
  applyRawTimelineUi(values);
  applyIsolationBackendUi();
}

function writeGeneralSettingsForm(values) {
  for (const field of generalSettingsFields) {
    if (generalSettingsForm.elements[field]) {
      if (generalSettingsForm.elements[field].type === "checkbox") {
        generalSettingsForm.elements[field].checked = values[field] === "true";
      } else {
        generalSettingsForm.elements[field].value = values[field] ?? "";
      }
    }
  }
  applyRawTimelineUi(values);
  syncStaleKeywordUserRetryControls();
  syncSearchWithoutApiRetryControls();
  syncStaleKeywordUserSpeedPresetFromValues();
}

function applyRawTimelineUi(values) {
  const rawTimelineEnabled = values?.RAW_TIMELINE_ENABLED !== "false";
  rawTimelineLinks.forEach((link) => {
    link.hidden = !rawTimelineEnabled;
  });
}

function syncStaleKeywordUserRetryControls() {
  const enabled = Boolean(staleKeywordUserAutoIgnoreAlert?.checked);
  if (staleKeywordUserMaxRetries) {
    staleKeywordUserMaxRetries.disabled = !enabled;
  }
  if (staleKeywordUserAutoRestartDelaySeconds) {
    staleKeywordUserAutoRestartDelaySeconds.disabled = !enabled;
  }
  document.getElementById("stale-keyword-user-max-retries-label")?.classList.toggle("is-check-disabled", !enabled);
  document.getElementById("stale-keyword-user-auto-restart-delay-label")?.classList.toggle("is-check-disabled", !enabled);
}

function syncSearchWithoutApiRetryControls() {
  const enabled = Boolean(searchWithoutApiAutoIgnoreAlert?.checked);
  if (searchWithoutApiMaxRetries) {
    searchWithoutApiMaxRetries.disabled = !enabled;
  }
  if (searchWithoutApiAutoRestartDelaySeconds) {
    searchWithoutApiAutoRestartDelaySeconds.disabled = !enabled;
  }
  document.getElementById("search-without-api-max-retries-label")?.classList.toggle("is-check-disabled", !enabled);
  document.getElementById("search-without-api-auto-restart-delay-label")?.classList.toggle("is-check-disabled", !enabled);
}

function inferStaleKeywordUserSpeedPreset(minSeconds, maxSeconds) {
  const presetEntries = Object.entries(staleKeywordUserSpeedPresets);
  for (const [key, preset] of presetEntries) {
    if (preset.min === minSeconds && preset.max === maxSeconds) {
      return key;
    }
  }
  return (
    presetEntries
      .map(([key, preset]) => ({
        key,
        distance: Math.abs(preset.min - minSeconds) + Math.abs(preset.max - maxSeconds)
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.key || "normal"
  );
}

function syncStaleKeywordUserSpeedPresetFromValues() {
  if (!staleKeywordUserSpeedPreset || !staleKeywordUserActionDelayMinSeconds || !staleKeywordUserActionDelayMaxSeconds) {
    return;
  }
  const minSeconds = Math.max(0, Math.floor(Number(staleKeywordUserActionDelayMinSeconds.value || 0)));
  const maxSeconds = Math.max(minSeconds, Math.floor(Number(staleKeywordUserActionDelayMaxSeconds.value || 0)));
  staleKeywordUserActionDelayMinSeconds.value = String(minSeconds);
  staleKeywordUserActionDelayMaxSeconds.value = String(maxSeconds);
  staleKeywordUserSpeedPreset.value = inferStaleKeywordUserSpeedPreset(minSeconds, maxSeconds);
}

function applyStaleKeywordUserSpeedPreset(presetKey) {
  const preset = staleKeywordUserSpeedPresets[presetKey] || staleKeywordUserSpeedPresets.normal;
  if (staleKeywordUserSpeedPreset) {
    staleKeywordUserSpeedPreset.value = presetKey in staleKeywordUserSpeedPresets ? presetKey : "normal";
  }
  if (staleKeywordUserActionDelayMinSeconds) {
    staleKeywordUserActionDelayMinSeconds.value = String(preset.min);
  }
  if (staleKeywordUserActionDelayMaxSeconds) {
    staleKeywordUserActionDelayMaxSeconds.value = String(preset.max);
  }
}

function describeStaleKeywordUserSpeedPreset(minSeconds, maxSeconds) {
  const presetKey = inferStaleKeywordUserSpeedPreset(minSeconds, maxSeconds);
  const preset = staleKeywordUserSpeedPresets[presetKey] || staleKeywordUserSpeedPresets.normal;
  if (minSeconds === 0 && maxSeconds === 0) {
    return `${preset.label}: no pause between actions.`;
  }
  if (minSeconds === maxSeconds) {
    return `${preset.label}: ${minSeconds} second pause between actions.`;
  }
  return `${preset.label}: random ${minSeconds}-${maxSeconds} second pauses between actions.`;
}

function staleKeywordUserSpeedSummary(minSeconds, maxSeconds) {
  const normalizedMinSeconds = Math.max(0, Math.floor(Number(minSeconds) || 0));
  const normalizedMaxSeconds = Math.max(normalizedMinSeconds, Math.floor(Number(maxSeconds) || 0));
  const presetKey = inferStaleKeywordUserSpeedPreset(normalizedMinSeconds, normalizedMaxSeconds);
  const preset = staleKeywordUserSpeedPresets[presetKey] || staleKeywordUserSpeedPresets.normal;
  if (normalizedMinSeconds === 0 && normalizedMaxSeconds === 0) {
    return `${preset.label} (no pause)`;
  }
  if (normalizedMinSeconds === normalizedMaxSeconds) {
    return `${preset.label} (${normalizedMinSeconds}s)`;
  }
  return `${preset.label} (${normalizedMinSeconds}-${normalizedMaxSeconds}s)`;
}

async function applyRunningStaleKeywordUserSpeed() {
  if (!currentStaleKeywordUserPruneStatus?.running) {
    return false;
  }
  const actionDelayMinSeconds = Math.max(0, Math.floor(Number(staleKeywordUserActionDelayMinSeconds?.value || 0)));
  const actionDelayMaxSeconds = Math.max(
    actionDelayMinSeconds,
    Math.floor(Number(staleKeywordUserActionDelayMaxSeconds?.value || 0))
  );
  const result = await jsonFetch("/admin/keyword-users/prune-stale/speed", {
    method: "POST",
    body: JSON.stringify({
      actionDelayMinSeconds,
      actionDelayMaxSeconds
    })
  });
  const status = result?.job ?? result;
  renderStaleKeywordUserPruneStatus(status);
  renderSessionStaleKeywordUserPrune(status);
  setStatus(`Inactive users check execution speed updated: ${staleKeywordUserSpeedSummary(actionDelayMinSeconds, actionDelayMaxSeconds)}.`);
  return true;
}

function writeServerAccessForm(config, currentIp) {
  for (const field of serverAccessFields) {
    if (serverAccessForm.elements[field]) {
      serverAccessForm.elements[field].value = (config?.[field] ?? []).join("\n");
    }
  }
  if (serverAccessCurrentIp) {
    serverAccessCurrentIp.textContent = currentIp ? `Current detected IPv4: ${currentIp}` : "";
  }
}

function readScoringForm() {
  const allowedLanguages = scoringForm.elements.allowedLanguages.value
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const config = { allowedLanguages };

  for (const field of scoringNumberFields) {
    config[field] = Number(scoringForm.elements[field].value);
  }
  for (const field of scoringBooleanFields) {
    if (scoringForm.elements[field]) {
      config[field] = scoringForm.elements[field].checked;
    }
  }

  return config;
}

const scoringPresets = {
  strict: {
    enableMinimumTweetScore: true,
    minimumTweetScore: 28,
    enableMaximumTweetAgeDays: true,
    maximumTweetAgeDays: 120,
    enableMinimumTweetLength: true,
    minimumTweetLength: 80,
    enableMaximumMentions: true,
    maximumMentions: 6,
    enableSimilarTweetText: true,
    similarTweetTextThreshold: 0.84
  },
  balanced: {
    enableMinimumTweetScore: true,
    minimumTweetScore: 18,
    enableMaximumTweetAgeDays: true,
    maximumTweetAgeDays: 365,
    enableMinimumTweetLength: true,
    minimumTweetLength: 60,
    enableMaximumMentions: true,
    maximumMentions: 10,
    enableSimilarTweetText: true,
    similarTweetTextThreshold: 0.9
  },
  permissive: {
    enableMinimumTweetScore: true,
    minimumTweetScore: 10,
    enableMaximumTweetAgeDays: true,
    maximumTweetAgeDays: 900,
    enableMinimumTweetLength: false,
    minimumTweetLength: 40,
    enableMaximumMentions: false,
    maximumMentions: 20,
    enableSimilarTweetText: true,
    similarTweetTextThreshold: 0.95
  }
};

function applyScoringPreset(name) {
  const preset = scoringPresets[name];
  if (!preset) return;
  for (const [field, value] of Object.entries(preset)) {
    const element = scoringForm.elements[field];
    if (!element) continue;
    if (element.type === "checkbox") {
      element.checked = Boolean(value);
    } else {
      element.value = String(value);
    }
  }
  applyScoringCheckUi();
  setStatus(`${name[0].toUpperCase()}${name.slice(1)} scoring preset applied. Save scoring to persist it.`);
}

function readServerAccessForm() {
  return Object.fromEntries(serverAccessFields.map((field) => [field, serverAccessForm.elements[field].value]));
}

function readEnvForm() {
  const values = {};
  for (const field of envFields) {
    const input = envForm.elements[field];
    if (input) {
      if (input.dataset.redacted === "true" && input.type !== "checkbox" && input.value === "") {
        continue;
      }
      values[field] =
        input.type === "checkbox"
          ? String(input.checked)
          : input.value;
    }
  }
  return { values };
}

function scopedSettingsFields(form, fields, submitter) {
  if (!submitter?.dataset?.settingsSection) return fields;
  const scope = submitter.closest(".settings-subsection") || form;
  const scopedNames = new Set(
    Array.from(scope.querySelectorAll("[name]"))
      .map((element) => element.name)
      .filter(Boolean)
  );
  return fields.filter((field) => scopedNames.has(field));
}

function readSettingsValues(form, fields, submitter) {
  const values = {};
  for (const field of scopedSettingsFields(form, fields, submitter)) {
    const input = form.elements[field];
    if (input) {
      if (input.dataset.redacted === "true" && input.type !== "checkbox" && input.value === "") {
        continue;
      }
      values[field] = input.type === "checkbox" ? String(input.checked) : input.value;
    }
  }
  return values;
}

function readXApiForm(submitter) {
  const values = readSettingsValues(xApiForm, xApiFields, submitter);
  return { values };
}

function readSearchWithoutApiForm(submitter) {
  const values = readSettingsValues(searchWithoutApiForm, searchWithoutApiFields, submitter);
  return { values };
}

function readGeneralSettingsForm(submitter) {
  const values = readSettingsValues(generalSettingsForm, generalSettingsFields, submitter);
  return { values };
}

function readOpenVpnSettingsForm() {
  const values = {};
  for (const field of openVpnSettingsFields) {
    if (searchWithoutApiForm.elements[field]) {
      values[field] = searchWithoutApiForm.elements[field].value;
    }
  }
  return values;
}

function applyRuntimeModeUi() {
  const xApiEnabledInput = xApiForm.elements.X_API_ENABLED;
  const searchWithoutApiEnabledInput = searchWithoutApiForm.elements.SEARCH_WITHOUT_API_ENABLED;
  const xApiEnabled = Boolean(xApiEnabledInput?.checked);
  const searchWithoutApiEnabled = Boolean(searchWithoutApiEnabledInput?.checked);

  if (searchWithoutApiEnabled && xApiEnabledInput) {
    xApiEnabledInput.checked = false;
  }
  if (xApiEnabled && searchWithoutApiEnabledInput) {
    searchWithoutApiEnabledInput.checked = false;
  }

  const normalizedXApiEnabled = Boolean(xApiEnabledInput?.checked);
  const normalizedSearchWithoutApiEnabled = Boolean(searchWithoutApiEnabledInput?.checked);

  if (xApiControls) {
    xApiControls.disabled = !normalizedXApiEnabled;
  }
  if (searchWithoutApiControls) {
    searchWithoutApiControls.disabled = !normalizedSearchWithoutApiEnabled;
  }
  applyIsolationBackendUi();
}

function applyIsolationBackendUi() {
  const isDockerVpn = currentSearchIsolation() === "docker_vpn";
  dockerVpnOnlySettings.forEach((container) => {
    container.classList.toggle("is-hidden", !isDockerVpn);
    for (const field of container.querySelectorAll("input, select, textarea, button")) {
      field.disabled = !isDockerVpn;
    }
  });
  hostNetnsOnlySettings.forEach((container) => {
    container.classList.toggle("is-disabled", isDockerVpn);
    for (const field of container.querySelectorAll("input, select, textarea, button")) {
      field.disabled = isDockerVpn;
    }
  });
  if (openVpnSudoDetail) {
    openVpnSudoDetail.textContent = isDockerVpn
      ? "Docker VPN mode does not use the host root helper."
      : "Check whether admin Start/Resume can prepare the VPN namespace without a sudo password prompt.";
  }
}

async function saveRuntimeModeSettings(values, statusMessage, feedbackTarget = null) {
  const result = await jsonFetch("/admin/settings/x-api", {
    method: "PATCH",
    body: JSON.stringify({ values })
  });
  if (!result) return null;
  writeXApiForm(result.values ?? {}, result.redactedKeys ?? []);
  writeGeneralSettingsForm(result.values ?? {});
  writeSearchWithoutApiForm(result.values ?? {});
  applyRuntimeModeUi();
  if (statusMessage) {
    const feedbackMessage = runtimeSettingsFeedback(result, statusMessage);
    if (feedbackTarget) {
      showButtonFeedback(feedbackTarget, feedbackMessage);
    } else {
      setStatus(feedbackMessage);
    }
  }
  await refreshStats();
  return result;
}

async function saveOpenVpnSettings() {
  const values = readOpenVpnSettingsForm();
  if (!values.VPN_CONFIG) {
    setStatus("Choose an OpenVPN profile before applying OpenVPN settings.");
    return;
  }

  const result = await saveRuntimeModeSettings(values, "OpenVPN settings saved.", openVpnSettingsSaveButton);
  if (!result) return;

  await refreshOpenVpnProfiles(result.values?.VPN_CONFIG ?? values.VPN_CONFIG);
  setStatus(runtimeSettingsFeedback(result, "OpenVPN settings saved."));
}

function runtimeSettingsFeedback(result, fallback) {
  const xApiModeShutdown = result?.xApiModeShutdown;
  if (xApiModeShutdown?.requested) {
    const vpnStop = xApiModeShutdown.openVpn?.stop || {};
    const namespaceTeardown = xApiModeShutdown.namespace?.teardown || {};
    if (vpnStop.requested || namespaceTeardown.requested) {
      return "X API mode enabled. VPN shutdown requested.";
    }
    if (vpnStop.reason === "no_running_openvpn_script" || vpnStop.reason === "skipped_in_test") {
      return "X API mode enabled. No active OpenVPN tunnel found.";
    }
    return "X API mode enabled. VPN runtime checked.";
  }
  const openVpn = result?.openVpn;
  if (!openVpn?.settingsChanged) {
    return fallback;
  }

  const stop = openVpn.stop || {};
  if (stop.requested && Array.isArray(stop.stillRunning) && stop.stillRunning.length > 0) {
    return "Saved. OpenVPN stop requested.";
  }
  if (stop.requested) {
    return "Saved. OpenVPN stopped.";
  }
  if (stop.reason === "no_running_openvpn_script") {
    return "Saved. No running OpenVPN found.";
  }
  if (stop.reason === "skipped_in_test") {
    return fallback;
  }
  return "Saved. Restart OpenVPN.";
}

function setupEnvSecretToggles() {
  envForm.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.parentElement?.classList.contains("secret-input-wrap")) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "secret-input-wrap";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secret-toggle";
    button.innerHTML = eyeOffIcon;
    button.setAttribute("aria-label", `Show ${input.name}`);
    button.title = "Show";
    wrapper.appendChild(button);

    button.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.innerHTML = visible ? eyeOffIcon : eyeIcon;
      button.setAttribute("aria-label", `${visible ? "Show" : "Hide"} ${input.name}`);
      button.title = visible ? "Show" : "Hide";
    });
  });
}

async function runAction(action, options = {}) {
  if (action === "start") {
    showAdminSection("session");
    updateSessionPolling();
    let result = null;
    try {
      result = await jsonFetch("/admin/runs", { method: "POST" });
    } catch (error) {
      const handled = await maybeResetSearchTermsUsedForStart(error, options);
      if (handled) {
        await runAction("start", { allowSearchTermsUsedResetPrompt: false });
        return;
      }
      throw error;
    }
    if (result) {
      setStatus(`Run started: ${result.run.id}`);
    }
    await openCurrentSessionSection();
    await refreshRunPreview();
    return;
  }

  if (action === "resume") {
    showAdminSection("session");
    updateSessionPolling();
  }
  const result = await jsonFetch(`/admin/runs/current/${action}`, { method: "POST" });
  if (result) {
    const rssFallback = result.rssFallback;
    if (rssFallback) {
      setStatus(
        `Run ${result.run.status}: ${result.run.id}. RSS fallback: ${rssFallback.savedItems} saved from ${rssFallback.feeds} feeds.`
      );
    } else {
      setStatus(`Run ${result.run.status}: ${result.run.id}`);
    }
  }
  if (action === "resume") {
    await openCurrentSessionSection();
    return;
  }
  await refreshStats();
  if (activeAdminSection() === "session") {
    await refreshCurrentSession();
    await refreshSessionKeywords();
    await refreshRunPreview();
  }
}

async function maybeResetSearchTermsUsedForStart(error, options = {}) {
  const payload = error?.payload;
  if (
    options.allowSearchTermsUsedResetPrompt === false ||
    payload?.reason !== "no_eligible_keywords" ||
    !payload.resetSearchTermsUsedAvailable
  ) {
    return false;
  }

  const availability = payload.availability || {};
  const searched = Number(availability.excludedBySearchTermsUsed ?? 0);
  const noResult = Number(availability.excludedByNoResult ?? 0);
  const confirmed = window.confirm(
    [
      "No eligible keyword is left for a new run.",
      "",
      `${searched} keyword${searched === 1 ? "" : "s"} are blocked by SearchTerms.Used.`,
      noResult > 0 ? `${noResult} keyword${noResult === 1 ? "" : "s"} will stay excluded by No.Result.` : "",
      "",
      "Reset SearchTerms.Used and start again?"
    ]
      .filter(Boolean)
      .join("\n")
  );
  if (!confirmed) {
    setStatus("Start cancelled. SearchTerms.Used was not reset.");
    await refreshRunPreview();
    return true;
  }

  const resetEndpoint = payload.resetSearchTermsUsedEndpoint || "/admin/settings/search-terms-used/reset";
  const reset = await jsonFetch(resetEndpoint, { method: "POST" });
  setStatus(`SearchTerms.Used reset: ${reset?.deleted ?? 0} active entries cleared. Starting a fresh run...`);
  await refreshStats();
  await refreshRunPreview();
  return true;
}

async function startStaleKeywordUserPrune() {
  const maxAgeDays = Number(staleKeywordUserDays?.value);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    setStatus("Enter a positive number of days before checking @keywords.");
    return;
  }
  const startIndex = Number(staleKeywordUserStartIndex?.value || 1);
  if (!Number.isFinite(startIndex) || startIndex < 1) {
    setStatus("Enter a positive start index before checking @keywords.");
    return;
  }
  const actionDelayMinSeconds = Number(staleKeywordUserActionDelayMinSeconds?.value || 0);
  const actionDelayMaxSeconds = Number(staleKeywordUserActionDelayMaxSeconds?.value || 0);
  if (!Number.isFinite(actionDelayMinSeconds) || actionDelayMinSeconds < 0) {
    setStatus("Enter a positive or zero minimum pause before checking @keywords.");
    return;
  }
  if (!Number.isFinite(actionDelayMaxSeconds) || actionDelayMaxSeconds < 0) {
    setStatus("Enter a positive or zero maximum pause before checking @keywords.");
    return;
  }
  const maxRetries = Number(staleKeywordUserMaxRetries?.value || 0);
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    setStatus("Enter a positive max retry value before checking @keywords.");
    return;
  }
  const autoRestartDelaySeconds = Number(staleKeywordUserAutoRestartDelaySeconds?.value || 0);
  if (!Number.isFinite(autoRestartDelaySeconds) || autoRestartDelaySeconds < 0) {
    setStatus("Enter a positive or zero auto-restart pause before checking @keywords.");
    return;
  }
  const autoIgnoreAlert = Boolean(staleKeywordUserAutoIgnoreAlert?.checked);
  const usesBrowserMode = Boolean(currentRuntimeModes.searchWithoutApiEnabled);
  const cleanupModeLabel = usesBrowserMode ? "X browser session" : "X API";
  const confirmed = window.confirm(
    [
      `This cleanup checks every keyword that starts with @ through ${cleanupModeLabel}.`,
      `It will start from user index ${Math.floor(startIndex)}.`,
      "If a run is currently active, it will be stopped before the cleanup starts.",
      describeStaleKeywordUserSpeedPreset(
        Math.floor(Math.min(actionDelayMinSeconds, actionDelayMaxSeconds)),
        Math.floor(Math.max(actionDelayMinSeconds, actionDelayMaxSeconds))
      ),
      usesBrowserMode
        ? autoIgnoreAlert
          ? `Ignore alerts is enabled: X session alerts raised by this cleanup will be marked ignored automatically and the cleanup can retry up to ${Math.floor(
              maxRetries
            )} time(s), waiting ${Math.floor(autoRestartDelaySeconds)} second(s) before each auto-restart.`
          : "If X raises a session alert, resolve it manually to continue this cleanup."
        : "In X API mode this cleanup does not depend on an X browser session, so alert retries are not used.",
      "",
      "Continue?"
    ].join("\n")
  );
  if (!confirmed) return;

  pruneStaleKeywordUsersButton.disabled = true;
  staleKeywordUserStartIndexTouched = false;
  setStatus("Starting stale @keyword cleanup...");
  const result = await jsonFetch("/admin/keyword-users/prune-stale", {
    method: "POST",
    body: JSON.stringify({
      maxAgeDays,
      startIndex: Math.floor(startIndex),
      actionDelayMinSeconds: Math.floor(actionDelayMinSeconds),
      actionDelayMaxSeconds: Math.floor(actionDelayMaxSeconds),
      autoIgnoreAlert,
      maxRetries: Math.floor(maxRetries),
      autoRestartDelaySeconds: Math.floor(autoRestartDelaySeconds)
    })
  });
  if (stopStaleKeywordUsersButton) stopStaleKeywordUsersButton.disabled = false;
  staleKeywordUserInlineListVisible = false;
  staleKeywordUserInlineListTouched = false;
  syncInlineStaleKeywordUsersToggle();
  renderStaleKeywordUserPruneStatus(result);
  pollStaleKeywordUserPruneStatusSoon();
}

async function stopStaleKeywordUserPrune() {
  if (!stopStaleKeywordUsersButton) return;
  stopStaleKeywordUsersButton.disabled = true;
  setStatus("Stopping stale @keyword cleanup...");
  const result = await jsonFetch("/admin/keyword-users/prune-stale/stop", { method: "POST" });
  renderStaleKeywordUserPruneStatus(result.job ?? result);
  await refreshStats();
  if (listState.kind === "keyword" || listState.kind === "stale_keyword_user" || listState.kind === "skipped_keyword_user") {
    await refreshList();
  }
}

async function resetStaleKeywordUserProgress() {
  if (!resetStaleKeywordUserProgressButton) return;
  const confirmed = window.confirm(
    [
      "Reset inactive users check progress?",
      "",
      "This clears the saved cleanup progress, resume state, and old cleanup reports.",
      "Start from index will be reset to 1.",
      "Stale users and skipped users lists will not be deleted.",
      "",
      "If a check is currently running, stop it first.",
      "Continue?"
    ].join("\n")
  );
  if (!confirmed) return;

  resetStaleKeywordUserProgressButton.disabled = true;
  setStatus("Resetting stale @keyword cleanup progress...");
  try {
    const result = await jsonFetch("/admin/keyword-users/prune-stale/progress/reset", { method: "POST" });
    if (!result) return;
    currentStaleKeywordUserPruneStatus = result.status ?? null;
    staleKeywordUserStartIndexTouched = false;
    if (staleKeywordUserStartIndex) {
      staleKeywordUserStartIndex.value = "1";
    }
    if (result.values) {
      writeGeneralSettingsForm(result.values);
    }
    renderStaleKeywordUserPruneStatus(result.status ?? result);
    showButtonFeedback(resetStaleKeywordUserProgressButton, "Reset.");
    setStatus(`Stale @keyword cleanup progress reset. Removed ${Number(result.reset?.deletedFiles?.length ?? 0)} progress file(s).`);
    await refreshStats();
    await refreshXApiSettings();
  } finally {
    resetStaleKeywordUserProgressButton.disabled = false;
  }
}

async function refreshStaleKeywordUserPruneStatus() {
  const result = await jsonFetch("/admin/keyword-users/prune-stale/current");
  renderStaleKeywordUserPruneStatus(result);
  if (!result?.job) {
    if (pruneStaleKeywordUsersButton) {
      pruneStaleKeywordUsersButton.disabled = false;
    }
    if (stopStaleKeywordUsersButton) {
      stopStaleKeywordUsersButton.disabled = false;
    }
    if (resetStaleKeywordUserProgressButton) {
      resetStaleKeywordUserProgressButton.disabled = false;
    }
    return;
  }
  if (result?.running) {
    if (stopStaleKeywordUsersButton) {
      stopStaleKeywordUsersButton.disabled = false;
    }
    pollStaleKeywordUserPruneStatusSoon();
    return;
  }
  if (shouldPollForStaleKeywordUserAutoRestart(result)) {
    pollStaleKeywordUserPruneStatusSoon(staleKeywordUserAutoRestartPending(result.job) ? 1000 : 2500);
    return;
  }
  if (pruneStaleKeywordUsersButton) {
    pruneStaleKeywordUsersButton.disabled = false;
  }
  if (stopStaleKeywordUsersButton) {
    stopStaleKeywordUsersButton.disabled = false;
  }
  await refreshStats();
  if (staleKeywordUserPruneCreditsDepleted(result)) {
    await refreshXApiSettings();
  }
  if (listState.kind === "keyword" || listState.kind === "stale_keyword_user") {
    await refreshList();
  }
}

function shouldPollForStaleKeywordUserAutoRestart(result) {
  const job = result?.job;
  if (!job || job.status !== "failed" || !job.autoIgnoreAlert || !job.blockedByAlertId) {
    return false;
  }
  const restartCount = Number(job.restartCount ?? 0);
  const maxRetries = Number(job.maxRetries ?? 0);
  return Number.isFinite(restartCount) && Number.isFinite(maxRetries) && restartCount < maxRetries;
}

function staleKeywordUserPruneCreditsDepleted(result) {
  const error = `${result?.job?.error || ""} ${result?.job?.report?.error || ""}`;
  return /credits?\s*depleted|http\s*402|code\s*402/i.test(error);
}

function staleKeywordUserAutoRestartRemainingSeconds(job) {
  const restartAt = Date.parse(job?.autoRestartAt || "");
  if (!Number.isFinite(restartAt)) {
    return null;
  }
  return Math.max(0, Math.ceil((restartAt - Date.now()) / 1000));
}

function staleKeywordUserAutoRestartPending(job) {
  return staleKeywordUserAutoRestartRemainingSeconds(job) !== null && job?.status !== "running";
}

function staleKeywordUserAutoRestartCountdownText(job) {
  const remainingSeconds = staleKeywordUserAutoRestartRemainingSeconds(job);
  if (remainingSeconds === null) {
    return "";
  }
  return `${remainingSeconds}s`;
}

function syncStaleKeywordUserPruneCountdown(result) {
  if (staleKeywordUserPruneCountdownTimer) {
    clearInterval(staleKeywordUserPruneCountdownTimer);
    staleKeywordUserPruneCountdownTimer = null;
  }
  if (!staleKeywordUserAutoRestartPending(result?.job)) {
    return;
  }
  staleKeywordUserPruneCountdownTimer = setInterval(() => {
    if (!staleKeywordUserAutoRestartPending(currentStaleKeywordUserPruneStatus?.job)) {
      clearInterval(staleKeywordUserPruneCountdownTimer);
      staleKeywordUserPruneCountdownTimer = null;
      return;
    }
    renderStaleKeywordUserPruneStatus(currentStaleKeywordUserPruneStatus, { skipCountdownSync: true });
    renderSessionStaleKeywordUserPrune(currentStaleKeywordUserPruneStatus);
    if (staleKeywordUserAutoRestartRemainingSeconds(currentStaleKeywordUserPruneStatus?.job) <= 0) {
      pollStaleKeywordUserPruneStatusSoon(500);
    }
  }, 1000);
}

function pollStaleKeywordUserPruneStatusSoon(delayMs = 2500) {
  if (staleKeywordUserPrunePollTimer) {
    clearTimeout(staleKeywordUserPrunePollTimer);
  }
  staleKeywordUserPrunePollTimer = setTimeout(() => {
    refreshStaleKeywordUserPruneStatus().catch((error) => {
      if (pruneStaleKeywordUsersButton) pruneStaleKeywordUsersButton.disabled = false;
      if (stopStaleKeywordUsersButton) stopStaleKeywordUsersButton.disabled = false;
      if (resetStaleKeywordUserProgressButton) resetStaleKeywordUserProgressButton.disabled = false;
      setStatus(error.message);
    });
  }, delayMs);
}

function renderStaleKeywordUserPruneStatus(result, options = {}) {
  if (typeof result?.running !== "boolean" && typeof result?.job?.running === "boolean") {
    result = result.job;
  }
  currentStaleKeywordUserPruneStatus = result?.job ? result : null;
  const running = Boolean(result?.running);
  const restartPending = staleKeywordUserAutoRestartPending(result?.job);
  if (pruneStaleKeywordUsersButton) pruneStaleKeywordUsersButton.disabled = running || restartPending;
  if (stopStaleKeywordUsersButton) stopStaleKeywordUsersButton.disabled = false;
  if (resetStaleKeywordUserProgressButton) resetStaleKeywordUserProgressButton.disabled = running;
  if (!staleKeywordUserPruneResult) return;
  const job = result?.job;
  if (!options.skipCountdownSync) {
    syncStaleKeywordUserPruneCountdown(result);
  }
  syncInlineStaleKeywordUsersToggle();
  const staleUsersList = staleKeywordUserInlineListVisible ? renderInlineStaleKeywordUsers(result?.staleUsers) : "";
  const statusEstimate = staleKeywordUserPruneEstimate(result, job);
  maybeApplyStaleKeywordUserSuggestedStartIndex(statusEstimate.suggestedStartIndex);
  const estimateLine = renderStaleKeywordUserEstimateLine(statusEstimate);
  if (!job) {
    staleKeywordUserPruneResult.innerHTML =
      estimateLine || staleUsersList ? `<div class="job-result-summary">${estimateLine}${staleUsersList}</div>` : "";
    return;
  }
  const report = job.report;
  const rawTotal = report?.totalCandidates ?? 0;
  const rawProcessed = report?.processedCandidates ?? 0;
  const progressSnapshot = staleKeywordUserProgressSnapshot(report, job, statusEstimate);
  const total = progressSnapshot.total;
  const processed = progressSnapshot.processed;
  const remaining = progressSnapshot.remaining;
  const removed = report?.removedUsers?.length ?? 0;
  const kept = report?.keptUsers?.length ?? 0;
  const skipped = report?.skippedUsers?.length ?? 0;
  const status = report?.status ?? job.status;
  const mode = report?.mode ?? job.mode ?? (currentRuntimeModes.searchWithoutApiEnabled ? "without_api" : "x_api");
  const modeLabel = mode === "x_api" ? "X API" : "browser session";
  const autoIgnoreLabel = mode === "without_api" && job.autoIgnoreAlert ? " - auto-ignore alerts" : "";
  const maxRetries = Number(job.maxRetries ?? 0);
  const autoRestartDelaySeconds = Number(job.autoRestartDelaySeconds ?? 0);
  const restartCount = Number(job.restartCount ?? 0);
  const displayedRestartCount = running ? 0 : restartCount;
  const staleUsersTotal = Number(result?.staleUsers?.total ?? 0);
  const startIndex = Number(job.startIndex ?? report?.startIndex ?? 1);
  const skippedBeforeStartIndex = Number(job.skippedBeforeStartIndex ?? report?.skippedBeforeStartIndex ?? 0);
  const actionDelayMinSeconds = Math.max(0, Math.floor(Number(job.actionDelayMinSeconds ?? report?.actionDelayMinSeconds ?? 0)));
  const actionDelayMaxSeconds = Math.max(
    actionDelayMinSeconds,
    Math.floor(Number(job.actionDelayMaxSeconds ?? report?.actionDelayMaxSeconds ?? actionDelayMinSeconds))
  );
  const stoppedRun = job.stoppedRun ? `<p>Stopped run: <code>${escapeHtml(job.stoppedRun.id)}</code></p>` : "";
  const error = job.error ? `<p class="status-problem">${escapeHtml(job.error)}</p>` : "";
  const progress = renderStaleKeywordUserProgress({ processed, total, remaining });
  const restartCountdown = staleKeywordUserAutoRestartCountdownText(job);
  const restartCountdownLine = restartCountdown ? `<p class="status-problem">Auto restart in <strong>${escapeHtml(restartCountdown)}</strong>.</p>` : "";
  const batchProgressLine =
    progressSnapshot.baseChecked > 0 && rawTotal > 0
      ? `<p>Current restart batch: <strong>${escapeHtml(rawProcessed)}</strong>/<strong>${escapeHtml(rawTotal)}</strong> checked.</p>`
      : "";
  const startIndexLine =
    startIndex > 1 || skippedBeforeStartIndex > 0
      ? `<p>Start index: <code>${escapeHtml(startIndex)}</code> (${escapeHtml(skippedBeforeStartIndex)} skipped before start).</p>`
      : "";
  const retryLine =
    mode === "without_api"
      ? `<p>Alert retries: <strong>${escapeHtml(displayedRestartCount)}</strong>/<strong>${escapeHtml(maxRetries)}</strong> - auto-restart pause: <strong>${escapeHtml(autoRestartDelaySeconds)}</strong>s</p>`
      : `<p>Alert retries: <strong>n/a</strong> in X API mode.</p>`;
  staleKeywordUserPruneResult.innerHTML = `
    <div class="job-result-summary">
      ${progress}
      <p>Mode: <strong>${escapeHtml(modeLabel)}</strong></p>
      <p>Execution speed: <strong>${escapeHtml(staleKeywordUserSpeedSummary(actionDelayMinSeconds, actionDelayMaxSeconds))}</strong></p>
      <p>Status: <strong>${escapeHtml(status)}</strong>${escapeHtml(autoIgnoreLabel)} - ${processed}/${total} checked - <strong>${remaining}</strong> @ remaining - ${kept} kept - ${skipped} skipped</p>
      <p>Stale list total: <strong>${escapeHtml(staleUsersTotal)}</strong></p>
      ${retryLine}
      ${restartCountdownLine}
      ${startIndexLine}
      ${batchProgressLine}
      ${estimateLine}
      ${stoppedRun}
      ${error}
      ${staleUsersList}
    </div>`;
  if (restartPending) {
    if (!options.skipCountdownSync) {
      setStatus(`Stale @keyword cleanup will auto-restart in ${restartCountdown || "0s"}.`);
    }
  } else if (status !== "running" && !options.skipCountdownSync) {
    const message =
      status === "completed"
        ? `Stale @keyword cleanup completed: ${removed} stale, ${kept} kept, ${skipped} skipped.`
        : status === "stopped"
          ? `Stale @keyword cleanup stopped: ${removed} stale, ${kept} kept, ${skipped} skipped.`
          : `Stale @keyword cleanup failed: ${job.error || "unknown error"}`;
    setStatus(message);
  }
}

function staleKeywordUserPruneEstimate(result, job) {
  return {
    checkedUsers: Number(result?.estimates?.checkedUsers ?? job?.estimatedCheckedUsers ?? 0),
    suggestedStartIndex: Number(result?.estimates?.suggestedStartIndex ?? job?.suggestedStartIndex ?? 1)
  };
}

function staleKeywordUserProgressSnapshot(report, job, estimate) {
  const rawTotal = Math.max(0, Number(report?.totalCandidates ?? 0));
  const rawProcessed = Math.max(0, Math.min(Number(report?.processedCandidates ?? 0), rawTotal || Number(report?.processedCandidates ?? 0)));
  if (!report || rawTotal <= 0) {
    return {
      processed: 0,
      total: 0,
      remaining: 0,
      baseChecked: 0,
      rawProcessed,
      rawTotal
    };
  }
  const skippedBeforeStartIndex = Math.max(0, Number(job?.skippedBeforeStartIndex ?? report?.skippedBeforeStartIndex ?? 0));
  const estimatedChecked = Math.max(0, Number(estimate?.checkedUsers ?? 0));
  const processed = Math.max(skippedBeforeStartIndex + rawProcessed, estimatedChecked);
  const baseChecked = Math.max(0, processed - rawProcessed);
  const total = Math.max(processed, baseChecked + rawTotal);
  return {
    processed,
    total,
    remaining: Math.max(0, total - processed),
    baseChecked,
    rawProcessed,
    rawTotal
  };
}

function maybeApplyStaleKeywordUserSuggestedStartIndex(suggestedStartIndex) {
  const currentStartIndex = Number(staleKeywordUserStartIndex?.value || 1);
  if (
    staleKeywordUserStartIndex &&
    Number.isFinite(suggestedStartIndex) &&
    suggestedStartIndex > 1 &&
    (!Number.isFinite(currentStartIndex) || suggestedStartIndex > currentStartIndex) &&
    !staleKeywordUserStartIndexTouched
  ) {
    staleKeywordUserStartIndex.value = String(suggestedStartIndex);
  }
}

function renderStaleKeywordUserEstimateLine(estimate) {
  if (!Number.isFinite(estimate.checkedUsers) || estimate.checkedUsers <= 0) {
    return "";
  }
  return `<p>Estimated already checked: <strong>${escapeHtml(estimate.checkedUsers)}</strong>. Suggested active-list start index: <code>${escapeHtml(
    estimate.suggestedStartIndex
  )}</code>.</p>`;
}

function syncInlineStaleKeywordUsersToggle() {
  if (!toggleInlineStaleKeywordUsersButton) return;
  toggleInlineStaleKeywordUsersButton.textContent = staleKeywordUserInlineListVisible ? "Hide stale users" : "Show stale users";
  toggleInlineStaleKeywordUsersButton.setAttribute("aria-expanded", staleKeywordUserInlineListVisible ? "true" : "false");
}

function renderStaleKeywordUserProgress({ processed, total, remaining }) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeProcessed = Math.max(0, Math.min(Number(processed) || 0, safeTotal || Number(processed) || 0));
  const max = Math.max(safeTotal, 1);
  const value = Math.min(safeProcessed, max);
  const percent = safeTotal > 0 ? Math.round((safeProcessed / safeTotal) * 100) : 0;
  return `
    <div class="stale-prune-progress">
      <div class="stale-prune-progress-head">
        <span>Progress</span>
        <strong>${escapeHtml(percent)}%</strong>
      </div>
      <progress max="${escapeAttribute(max)}" value="${escapeAttribute(value)}"></progress>
      <div class="stale-prune-progress-meta">
        <span>${escapeHtml(safeProcessed)}/${escapeHtml(safeTotal)} checked</span>
        <span><strong>${escapeHtml(remaining)}</strong> @ remaining</span>
      </div>
    </div>`;
}

function formatRemovedKeywordUserDetail(user) {
  if (user?.reason === "protected_posts") {
    return "protected posts";
  }
  const date = user?.latestTweetCreatedAt || "unknown date";
  const age = user?.ageDays ?? "?";
  return `${date} - ${age} days`;
}

function renderInlineStaleKeywordUsers(staleUsers) {
  const entries = Array.isArray(staleUsers?.entries) ? staleUsers.entries : [];
  const total = Number(staleUsers?.total ?? entries.length);
  const shown = entries.length;
  const summary =
    total > shown
      ? `Stale users (${shown}/${total} shown)`
      : `Stale users (${total})`;
  const rows = entries.length
    ? entries
        .map((entry) => {
          const value = entry.rawValue || "(empty line)";
          const date = formatAlertDate(entry.importedAt || entry.createdAt);
          return `<div class="stale-prune-user stale-prune-user-inline">
            <code>${escapeHtml(value)}</code>
            <span>${escapeHtml(date)}</span>
            <button class="list-row-action secondary-button" type="button" data-stale-inline-restore="${escapeAttribute(
              entry.id
            )}">Re-enable</button>
          </div>`;
        })
        .join("")
    : '<p class="stale-prune-empty">No stale keyword users.</p>';
  const more = staleUsers?.hasMore ? '<p class="stale-prune-empty">Open stale users list to see the full list.</p>' : "";
  return `
    <div class="stale-keyword-users-inline">
      <div class="stale-keyword-users-inline-head">
        <strong>${escapeHtml(summary)}</strong>
      </div>
      <div class="stale-keyword-users-inline-list">
        ${rows}
      </div>
      ${more}
    </div>`;
}

document.getElementById("list-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const form = new FormData(event.currentTarget);
  const kind = form.get("kind");
  const value = form.get("value");
  const action = submitter?.value || "add";

  if (action === "update") {
    if (!listState.selectedEntry) return;
    await jsonFetch(`/admin/lists/${encodeURIComponent(kind)}/${listState.selectedEntry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ value })
    });
    showButtonFeedback(submitter, "Saved.");
  } else if (action === "delete") {
    if (!listState.selectedEntry) return;
    const result = await jsonFetch(`/admin/lists/${encodeURIComponent(kind)}/${listState.selectedEntry.id}`, {
      method: "DELETE"
    });
    if (!result) return;
    setStatus(`Deleted entries: ${result.deleted}`);
  } else {
    await jsonFetch(`/admin/lists/${encodeURIComponent(kind)}`, {
      method: "POST",
      body: JSON.stringify({ value })
    });
    showButtonFeedback(submitter, "Added.");
  }

  entryValue.value = "";
  await refreshStats();
  await refreshList();
});

cleanupListsButton?.addEventListener("click", () => {
  cleanupLists().catch((error) => setStatus(error.message));
});

promoteAllSuggestedKeywordsButton?.addEventListener("click", () => {
  promoteAllSuggestedKeywords().catch((error) => setStatus(error.message));
});

deleteAllListButton?.addEventListener("click", () => {
  deleteAllSelectedListEntries().catch((error) => setStatus(error.message));
});

scoringForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const result = await jsonFetch("/admin/settings/scoring", {
    method: "PATCH",
    body: JSON.stringify(readScoringForm())
  });
  if (!result) return;
  showButtonFeedback(submitter, "Saved.");
  await refreshScoringSettings();
});
scoringBooleanFields.forEach((field) => {
  scoringForm.elements[field]?.addEventListener("change", applyScoringCheckUi);
});
document.querySelectorAll("[data-scoring-preset]").forEach((button) => {
  button.addEventListener("click", () => applyScoringPreset(button.dataset.scoringPreset));
});

generalSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const payload = readGeneralSettingsForm(submitter);
  const result = await saveRuntimeModeSettings(payload.values, "Saved.", submitter);
  if (!result) return;
});

xApiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const payload = readXApiForm(submitter);
  if (Object.hasOwn(payload.values, "X_API_ENABLED") && payload.values.X_API_ENABLED === "true") {
    payload.values.SEARCH_WITHOUT_API_ENABLED = "false";
  }
  const result = await saveRuntimeModeSettings(payload.values, "Saved.", submitter);
  if (!result) return;
});

searchWithoutApiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const payload = readSearchWithoutApiForm(submitter);
  if (Object.hasOwn(payload.values, "SEARCH_WITHOUT_API_ENABLED") && payload.values.SEARCH_WITHOUT_API_ENABLED === "true") {
    payload.values.X_API_ENABLED = "false";
  }
  const result = await saveRuntimeModeSettings(
    payload.values,
    "Saved.",
    submitter
  );
  if (!result) return;
});

xApiForm.elements.X_API_ENABLED.addEventListener("change", () => {
  const enabled = xApiForm.elements.X_API_ENABLED.checked;
  if (enabled) {
    searchWithoutApiForm.elements.SEARCH_WITHOUT_API_ENABLED.checked = false;
  }
  applyRuntimeModeUi();
  saveRuntimeModeSettings(
    {
      X_API_ENABLED: String(enabled),
      SEARCH_WITHOUT_API_ENABLED: enabled ? "false" : "false"
    },
    enabled ? "X API search enabled." : "X API search disabled; active run stopped if one was running."
  ).catch((error) => setStatus(error.message));
});

searchWithoutApiForm.elements.SEARCH_WITHOUT_API_ENABLED.addEventListener("change", () => {
  const enabled = searchWithoutApiForm.elements.SEARCH_WITHOUT_API_ENABLED.checked;
  if (enabled) {
    xApiForm.elements.X_API_ENABLED.checked = false;
  }
  applyRuntimeModeUi();
  saveRuntimeModeSettings(
    {
      SEARCH_WITHOUT_API_ENABLED: String(enabled),
      X_API_ENABLED: enabled ? "false" : String(xApiForm.elements.X_API_ENABLED.checked)
    },
    enabled
      ? "Search without Api enabled. X API search was disabled and any active X run was stopped."
      : "Search without Api disabled."
  ).catch((error) => setStatus(error.message));
});

searchWithoutApiForm.elements.SEARCH_WITHOUT_API_ISOLATION?.addEventListener("change", () => {
  applyIsolationBackendUi();
  renderXBrowserAccountPanel(currentVpnProfilePath());
  if (selectedXSessionAlertId) {
    const alert = xSessionAlerts.find((item) => String(item.id) === String(selectedXSessionAlertId));
    if (alert) renderXSessionAlertDetail(alert);
  }
});

openVpnProfileSelect?.addEventListener("change", () => {
  const profile = findOpenVpnProfileByPath(openVpnProfileSelect.value);
  if (!profile) {
    renderOpenVpnProfileDetail(null, searchWithoutApiForm.elements.VPN_CONFIG?.value ?? "");
    renderXBrowserAccountPanel(currentVpnProfilePath());
    return;
  }
  selectOpenVpnProfile(profile);
  setStatus(`OpenVPN profile selected: ${profile.filename}. Save Search without Api settings to make it active.`);
});

xBrowserAccountSelect?.addEventListener("change", () => {
  const account = accountById(xBrowserAccountSelect.value);
  if (!account) {
    renderXBrowserAccountPanel(currentVpnProfilePath());
    return;
  }

  const profile = findOpenVpnProfileByPath(account.vpnProfilePath);
  if (profile) {
    openVpnProfileSelect.value = profile.relativePath;
    selectOpenVpnProfile(profile);
  } else if (searchWithoutApiForm.elements.VPN_CONFIG) {
    searchWithoutApiForm.elements.VPN_CONFIG.value = account.vpnProfilePath;
  }
  renderXBrowserSessionValidation(account);
  renderXBrowserAccountDetail(account, account.vpnProfilePath);
});

xBrowserAccountSave?.addEventListener("click", () => {
  saveXBrowserAccount().catch((error) => setStatus(error.message));
});

xBrowserAccountDelete?.addEventListener("click", () => {
  deleteSelectedXBrowserAccount().catch((error) => setStatus(error.message));
});

xBrowserSessionExport?.addEventListener("click", () => {
  exportSelectedXBrowserSession();
});

xBrowserSessionImport?.addEventListener("click", () => {
  if (!selectedXBrowserAccount()) {
    setStatus("Select or save an X browser account before importing a session.");
    return;
  }
  xBrowserSessionImportFile?.click();
});

xBrowserSessionImportFile?.addEventListener("change", () => {
  const file = xBrowserSessionImportFile.files?.[0];
  importSelectedXBrowserSessionFile(file)
    .catch((error) => setStatus(error.message))
    .finally(() => {
      xBrowserSessionImportFile.value = "";
    });
});

openVpnShutdownButton?.addEventListener("click", () => {
  shutdownOpenVpn().catch((error) => setStatus(error.message));
});

openVpnSudoStatusButton?.addEventListener("click", () => {
  checkOpenVpnSudoStatus().catch((error) => setStatus(error.message));
});

openVpnSettingsSaveButton?.addEventListener("click", () => {
  saveOpenVpnSettings().catch((error) => setStatus(error.message));
});

resetXCountersButton.addEventListener("click", async () => {
  const result = await jsonFetch("/admin/settings/x-counters/reset", { method: "POST" });
  if (!result) return;
  const cost = result.budget?.estimatedCostUsd;
  const costLabel = typeof cost === "number" ? ` Preserved cost: $${cost.toFixed(3)}.` : "";
  showButtonFeedback(resetXCountersButton, "Reset.");
  if (costLabel) setStatus(costLabel.trim());
  await refreshStats();
  if (activeAdminSection() === "session") {
    await refreshCurrentSession();
  }
});

resetXBudgetButton.addEventListener("click", async () => {
  const result = await jsonFetch("/admin/settings/x-budget/reset", { method: "POST" });
  if (!result) return;
  showButtonFeedback(resetXBudgetButton, "Reset.");
  await refreshStats();
});

envForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const result = await jsonFetch("/admin/env", {
    method: "PATCH",
    body: JSON.stringify(readEnvForm())
  });
  if (!result) return;
  writeEnvForm(result.values ?? {}, result.redactedKeys ?? []);
  showButtonFeedback(submitter, "Saved.");
  if (result.restartScheduled) {
    setStatus("Automatic restart in progress...");
  }
});

loadFileButton.addEventListener("click", async () => {
  const files = selectedImportFiles();
  if (!files.length) {
    setStatus("Choose one or more local files.");
    return;
  }

  setStatus(`Importing ${files.length} file${files.length === 1 ? "" : "s"} into the interface...`);
  pendingImports = await readSelectedImportFiles();
  saveImportButton.disabled = false;
  renderImportFileDetail();
  setStatus(`${pendingImports.length} file${pendingImports.length === 1 ? "" : "s"} imported. You can now save to SQLite.`);
});

downloadListButton?.addEventListener("click", () => {
  downloadActiveList();
});

downloadTimelineTweetsButton?.addEventListener("click", () => {
  downloadTimelineTweets();
});

saveImportButton.addEventListener("click", async () => {
  setStatus(`Saving ${pendingImports.length} file${pendingImports.length === 1 ? "" : "s"} to SQLite...`);
  const results = await savePendingImports();
  if (!results) return;

  const imported = countImportedLinesFromResults(results);
  showButtonFeedback(saveImportButton, `Saved ${imported}.`);
  const visibleKind = pickVisibleKindFromResults(results);
  if (visibleKind) {
    editKind.value = visibleKind;
  }
  await refreshStats();
  await refreshList();
});

saveAllImportButton.addEventListener("click", async () => {
  const files = selectedImportFiles();
  if (!files.length) {
    setStatus("Choose files to import from your computer.");
    return;
  }

  setStatus(`Importing and saving ${files.length} file${files.length === 1 ? "" : "s"}...`);
  pendingImports = await readSelectedImportFiles();
  saveImportButton.disabled = false;
  renderImportFileDetail();
  const results = await savePendingImports();
  if (!results) return;

  const imported = countImportedLinesFromResults(results);
  showButtonFeedback(saveAllImportButton, `Saved ${imported}.`);
  await refreshStats();
  await refreshList();
});

databaseRefreshButton.addEventListener("click", () => {
  refreshDatabaseOverview().catch((error) => setStatus(error.message));
});
databaseIntegrityButton.addEventListener("click", () => {
  runDatabaseMaintenance("integrity-check").catch((error) => setStatus(error.message));
});
databaseAnalyzeButton.addEventListener("click", () => {
  runDatabaseMaintenance("analyze").catch((error) => setStatus(error.message));
});
databaseVacuumButton.addEventListener("click", () => {
  runDatabaseMaintenance("vacuum").catch((error) => setStatus(error.message));
});
databaseDownloadJsonButton.addEventListener("click", () => downloadDatabaseTable("json"));
databaseDownloadCsvButton.addEventListener("click", () => downloadDatabaseTable("csv"));
databaseClearTableButton.addEventListener("click", () => {
  clearSelectedDatabaseTable().catch((error) => setStatus(error.message));
});
databaseTables.addEventListener("click", (event) => {
  const row = event.target.closest(".database-table-row");
  if (!row) return;
  const tableName = decodeURIComponent(row.dataset.tableName || "");
  if (!tableName) return;
  selectDatabaseTable(tableName).catch((error) => setStatus(error.message));
});

editKind.addEventListener("change", refreshList);
listSearch.addEventListener("input", () => {
  if (listSearchTimer) {
    clearTimeout(listSearchTimer);
  }
  listSearchTimer = setTimeout(() => {
    refreshList().catch((error) => setStatus(error.message));
  }, 250);
});
listSearchMatches?.addEventListener("click", (event) => {
  const matchButton = event.target.closest("[data-search-match-kind]");
  if (!matchButton) return;
  openListSearchMatch(matchButton).catch((error) => setStatus(error.message));
});
document.querySelectorAll("[data-admin-section-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const section = button.dataset.adminSectionTarget;
    showAdminSection(section);
    if (section === "session") {
      refreshStats().catch((error) => setStatus(error.message));
      refreshCurrentSession().catch((error) => setStatus(error.message));
      refreshSessionKeywords().catch((error) => setStatus(error.message));
      refreshRunPreview().catch((error) => setStatus(error.message));
    }
    if (section === "tests") {
      refreshBrowserSnapshots().catch((error) => setStatus(error.message));
    }
    if (section === "session-alerts") {
      refreshXSessionAlerts().catch((error) => setStatus(error.message));
    }
    if (section === "settings") {
      Promise.all([refreshServerAccessSettings(), refreshScoringSettings(), refreshTimelineUsers(), refreshXApiSettings()]).catch((error) =>
        setStatus(error.message)
      );
    }
    if (section === "database") {
      refreshDatabaseOverview().catch((error) => setStatus(error.message));
    }
    if (section === "env") {
      refreshEnvSettings().catch((error) => setStatus(error.message));
    }
    if (section === "system") {
      refreshSystemHealth().catch((error) => setStatus(error.message));
    }
    updateSessionPolling();
  });
});
systemHealthRefreshButton?.addEventListener("click", () => {
  refreshSystemHealth().catch((error) => setStatus(error.message));
});
timelineUsersList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeline-user-id]");
  if (!button) return;
  selectTimelineUser(button.dataset.timelineUserId);
});
timelineUserSave?.addEventListener("click", () => {
  saveTimelineUser().catch((error) => {
    if (timelineUsersStatus) timelineUsersStatus.textContent = error.message || "Unable to save timeline user.";
  });
});
timelineUserClear?.addEventListener("click", clearTimelineUserForm);
timelineUserDelete?.addEventListener("click", () => {
  deleteTimelineUser().catch((error) => {
    if (timelineUsersStatus) timelineUsersStatus.textContent = error.message || "Unable to delete timeline user.";
  });
});
document.querySelectorAll("[data-run-action]").forEach((button) => {
  button.addEventListener("click", () => {
    runAction(button.dataset.runAction).catch((error) => setStatus(error.message));
  });
});
xSessionAlertResolve?.addEventListener("click", () => {
  resolveCurrentXSessionAlert().catch((error) => setStatus(error.message));
});
xSessionAlertLogin?.addEventListener("click", () => {
  launchXSessionAlertLogin(xSessionAlertLogin.dataset.alertId, xSessionAlertLogin).catch((error) => setStatus(error.message));
});
xSessionAlertIgnore?.addEventListener("click", () => {
  ignoreCurrentXSessionAlert().catch((error) => setStatus(error.message));
});
sessionAlertsRefreshButton?.addEventListener("click", () => {
  refreshXSessionAlerts().catch((error) => setStatus(error.message));
});
sessionAlertsList?.addEventListener("click", (event) => {
  const row = event.target.closest(".session-alert-row");
  if (!row) return;
  const alert = findXSessionAlert(row.dataset.alertId);
  if (!alert) return;
  document.querySelectorAll(".session-alert-row.is-selected").forEach((item) => item.classList.remove("is-selected"));
  row.classList.add("is-selected");
  renderSelectedSessionAlert(alert);
});
sessionAlertDetailResolve?.addEventListener("click", () => {
  resolveSelectedXSessionAlert().catch((error) => setStatus(error.message));
});
sessionAlertDetailLogin?.addEventListener("click", () => {
  launchXSessionAlertLogin(sessionAlertDetailLogin.dataset.alertId, sessionAlertDetailLogin).catch((error) =>
    setStatus(error.message)
  );
});
sessionAlertDetailIgnore?.addEventListener("click", () => {
  ignoreSelectedXSessionAlert().catch((error) => setStatus(error.message));
});
sessionAlertDetail?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-alert-snapshot-id]");
  if (!button) return;
  loadXSessionAlertSnapshot(button.dataset.alertSnapshotId, button).catch((error) => setStatus(error.message));
});
sessionAlertDetail?.addEventListener("input", (event) => {
  const slider = event.target.closest("[data-alert-snapshot-height]");
  if (!slider) return;
  updateAlertSnapshotHeight(slider.dataset.alertSnapshotHeight, slider.value);
});
sessionRefreshButton.addEventListener("click", () => {
  refreshCurrentSession().catch((error) => setStatus(error.message));
  refreshSessionKeywords().catch((error) => setStatus(error.message));
  refreshRunPreview().catch((error) => setStatus(error.message));
});
sessionKeywordsRefreshButton?.addEventListener("click", () => {
  refreshSessionKeywords().catch((error) => setStatus(error.message));
  refreshRunPreview().catch((error) => setStatus(error.message));
});
runPreviewRefreshButton?.addEventListener("click", () => {
  refreshRunPreview().catch((error) => setStatus(error.message));
});
runPreviewList?.addEventListener("toggle", (event) => {
  const panel = event.target.closest?.("[data-run-preview-index]");
  if (!panel) return;
  const runIndex = panel.dataset.runPreviewIndex;
  if (!runIndex) return;
  if (panel.open) {
    runPreviewOpenState.add(runIndex);
  } else {
    runPreviewOpenState.delete(runIndex);
  }
}, true);
sessionLog?.addEventListener("scroll", updateSessionStickStateFromScroll);
sessionStickBottom?.addEventListener("change", () => {
  sessionShouldStickBottom = Boolean(sessionStickBottom.checked);
  if (sessionShouldStickBottom) {
    sessionLog.scrollTop = sessionLog.scrollHeight;
  }
});
sessionFullscreenButton?.addEventListener("click", () => {
  toggleSessionFullscreen().catch((error) => setStatus(error.message));
});
adminTestButtons.forEach((button) => {
  button.addEventListener("click", () => {
    runAdminTest(button.dataset.adminTest, button).catch((error) => setStatus(error.message));
  });
});
browserSnapshotsRefreshButton?.addEventListener("click", () => {
  refreshBrowserSnapshots().catch((error) => setStatus(error.message));
});
browserSnapshotsList?.addEventListener("click", (event) => {
  const row = event.target.closest(".snapshot-row");
  if (!row) return;
  selectBrowserSnapshot(row.dataset.runId, row.dataset.filename).catch((error) => setStatus(error.message));
});
sessionAutoRefresh.addEventListener("change", updateSessionPolling);
sessionLevelOptions.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      input.checked = true;
    }
    selectSessionLevel(input);
    refreshCurrentSessionSoon();
  });
});
sessionIncludeAdminPolling.addEventListener("change", () => {
  refreshCurrentSessionSoon();
});
[sessionTweetContent, sessionTweetScore, sessionTweetFavorites, sessionTweetRetweets].forEach((input) => {
  input.addEventListener("change", refreshCurrentSessionSoon);
});
document.addEventListener("fullscreenchange", () => {
  if (sessionFullscreenButton) {
    sessionFullscreenButton.textContent = document.fullscreenElement === sessionLog ? "Exit full screen" : "Full screen";
  }
});
importLocalFile.addEventListener("change", () => {
  pendingImports = [];
  saveImportButton.disabled = true;
  const files = selectedImportFiles();
  const inferredKind = files.length === 1 ? inferKindFromFilename(files[0].name) : null;
  if (inferredKind) {
    importKind.value = inferredKind;
  }
  renderImportFileDetail();
});
importKind.addEventListener("change", () => {
  if (pendingImports.length === 1) {
    pendingImports[0].kind = importKind.value;
    renderImportFileDetail();
  }
});
clearSelectionButton.addEventListener("click", () => {
  entryValue.value = "";
  clearSelection();
});
listContent.addEventListener("click", (event) => {
  const promoteSuggestedButton = event.target.closest("[data-promote-suggested-keyword]");
  if (promoteSuggestedButton) {
    event.preventDefault();
    event.stopPropagation();
    promoteSuggestedKeyword(promoteSuggestedButton.dataset.promoteSuggestedKeyword, promoteSuggestedButton).catch((error) =>
      setStatus(error.message)
    );
    return;
  }
  const restoreButton = event.target.closest("[data-restore-stale-keyword-user]");
  if (restoreButton) {
    event.preventDefault();
    event.stopPropagation();
    restoreStaleKeywordUser(restoreButton.dataset.restoreStaleKeywordUser, restoreButton).catch((error) => setStatus(error.message));
    return;
  }
  const moveSkippedButton = event.target.closest("[data-move-skipped-keyword-user-to-stale]");
  if (moveSkippedButton) {
    event.preventDefault();
    event.stopPropagation();
    moveSkippedKeywordUserToStale(moveSkippedButton.dataset.moveSkippedKeywordUserToStale, moveSkippedButton).catch((error) =>
      setStatus(error.message)
    );
    return;
  }
  const row = event.target.closest(".list-row");
  if (row) {
    selectEntry(row);
  }
});
listContent.addEventListener("scroll", () => {
  const nearBottom = listContent.scrollTop + listContent.clientHeight >= listContent.scrollHeight - 48;
  if (nearBottom) {
    loadNextListPage().catch((error) => setStatus(error.message));
  }
});

serverAccessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (currentAdminAuthMode() === "mtls_proxy") {
    setStatus("Server access lists are disabled while client certificate authentication is active.");
    return;
  }
  const submitter = event.submitter;
  const result = await jsonFetch("/admin/settings/server-access", {
    method: "PATCH",
    body: JSON.stringify(readServerAccessForm())
  });
  if (!result) return;
  writeServerAccessForm(result.config, result.currentIp);
  showButtonFeedback(submitter, "Saved.");
});

pruneStaleKeywordUsersButton?.addEventListener("click", () => {
  startStaleKeywordUserPrune().catch((error) => {
    setStatus(error.message);
    refreshStaleKeywordUserPruneStatus().catch((refreshError) => {
      if (pruneStaleKeywordUsersButton) pruneStaleKeywordUsersButton.disabled = false;
      if (stopStaleKeywordUsersButton) stopStaleKeywordUsersButton.disabled = false;
      setStatus(refreshError.message);
    });
  });
});

stopStaleKeywordUsersButton?.addEventListener("click", () => {
  stopStaleKeywordUserPrune().catch((error) => {
    setStatus(error.message);
    refreshStaleKeywordUserPruneStatus().catch((refreshError) => setStatus(refreshError.message));
  });
});

resetStaleKeywordUserProgressButton?.addEventListener("click", () => {
  resetStaleKeywordUserProgress().catch((error) => {
    setStatus(error.message);
    refreshStaleKeywordUserPruneStatus().catch((refreshError) => setStatus(refreshError.message));
  });
});

openStaleKeywordUsersButton?.addEventListener("click", () => {
  openStaleKeywordUsersList().catch((error) => setStatus(error.message));
});

toggleInlineStaleKeywordUsersButton?.addEventListener("click", () => {
  staleKeywordUserInlineListVisible = !staleKeywordUserInlineListVisible;
  staleKeywordUserInlineListTouched = true;
  syncInlineStaleKeywordUsersToggle();
  refreshStaleKeywordUserPruneStatus().catch((error) => setStatus(error.message));
});

openSkippedKeywordUsersButton?.addEventListener("click", () => {
  openSkippedKeywordUsersList().catch((error) => setStatus(error.message));
});

staleKeywordUserStartIndex?.addEventListener("input", () => {
  staleKeywordUserStartIndexTouched = true;
});

staleKeywordUserSpeedPreset?.addEventListener("change", async () => {
  applyStaleKeywordUserSpeedPreset(staleKeywordUserSpeedPreset.value);
  if (!currentStaleKeywordUserPruneStatus?.running) {
    return;
  }
  try {
    await applyRunningStaleKeywordUserSpeed();
  } catch (error) {
    if (error instanceof Error && error.message === "No running stale keyword user pruning job.") {
      currentStaleKeywordUserPruneStatus = null;
      refreshStaleKeywordUserPruneStatus().catch(() => undefined);
      return;
    }
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

staleKeywordUserAutoIgnoreAlert?.addEventListener("change", syncStaleKeywordUserRetryControls);
searchWithoutApiAutoIgnoreAlert?.addEventListener("change", syncSearchWithoutApiRetryControls);
envForm?.elements?.ADMIN_AUTH_MODE?.addEventListener("change", applyAdminAuthModeUi);

staleKeywordUserPruneResult?.addEventListener("click", (event) => {
  const restore = event.target.closest("[data-stale-inline-restore]");
  if (restore) {
    restoreStaleKeywordUser(restore.dataset.staleInlineRestore, restore).catch((error) => setStatus(error.message));
    return;
  }
});

const initialAdminSection = window.location.hash.replace("#", "");
if (initialAdminSection && document.getElementById(`admin-section-${initialAdminSection}`)) {
  showAdminSection(initialAdminSection);
  if (initialAdminSection === "system") {
    refreshSystemHealth().catch((error) => setStatus(error.message));
  }
  if (initialAdminSection === "session") {
    refreshRunPreview().catch((error) => setStatus(error.message));
  }
  updateSessionPolling();
} else {
  updateSessionPolling();
  refreshCurrentSession().catch((error) => setStatus(error.message));
  refreshSessionKeywords().catch((error) => setStatus(error.message));
  refreshRunPreview().catch((error) => setStatus(error.message));
}

refreshStats()
  .then(refreshServerAccessSettings)
  .then(refreshScoringSettings)
  .then(refreshTimelineUsers)
  .then(refreshXApiSettings)
  .then(refreshStaleKeywordUserPruneStatus)
  .then(refreshEnvSettings)
  .then(refreshList)
  .catch((error) => setStatus(error.message));

setupEnvSecretToggles();
setupAdminHelp();
setupPathPickers();
setupOpenVpnAuthDialog();
applyBulkOpenVpnAuthModeUi();
