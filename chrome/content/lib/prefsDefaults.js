// For description of these values see http://adblockcash.org/en/preferences

// Prefs imported from abc-chrome (should be the same as in abc-chrome/lib/prefs)
let defaults = {
  enabled: true,
  data_directory: "",
  patternsbackups: 5,
  patternsbackupinterval: 24,
  savestats: false,
  privateBrowsing: false,
  subscriptions_fallbackerrors: 5,
  subscriptions_fallbackurl: "https://adblockplus.org/getSubscription?version=%VERSION%&url=%SUBSCRIPTION%&downloadURL=%URL%&error=%ERROR%&channelStatus=%CHANNELSTATUS%&responseStatus=%RESPONSESTATUS%",
  subscriptions_autoupdate: true,
  subscriptions_antiadblockurl: "https://easylist-downloads.adblockplus.org/antiadblockfilters.txt",
  subscriptions_tracking_title: "EasyPrivacy",
  subscriptions_tracking_url: "https://easylist-downloads.adblockplus.org/easyprivacy.txt",
  documentation_link: "https://adblockplus.org/redirect?link=%LINK%&lang=%LANG%",
  notificationdata: {},
  notificationurl: "",
  stats_total: {},
  stats_by_domain: {},
  show_statsinicon: true,
  show_statsinpopup: true,
  shouldShowBlockElementMenu: true,
  hidePlaceholders: true,
  blockedCashableDomains: [],
  adblockcash_visitor: null,
  adblockcash_cashableWebsites: null
};

for (key in defaults) {
  let value = defaults[key];

  pref("extensions.adblockcash." + key, value);
}


// Only-firefox prefs
pref("extensions.adblockcash.currentVersion", "0.0");
pref("extensions.adblockcash.frameobjects", true);
pref("extensions.adblockcash.fastcollapse", false);
pref("extensions.adblockcash.showinstatusbar", false);
pref("extensions.adblockcash.detachsidebar", false);
pref("extensions.adblockcash.defaulttoolbaraction", 0);
pref("extensions.adblockcash.defaultstatusbaraction", 0);
pref("extensions.adblockcash.sidebar_key", "Accel Shift V, Accel Shift U");
pref("extensions.adblockcash.sendReport_key", "");
pref("extensions.adblockcash.filters_key", "Accel Shift E, Accel Shift F, Accel Shift O");
pref("extensions.adblockcash.enable_key", "");
pref("extensions.adblockcash.flash_scrolltoitem", true);
pref("extensions.adblockcash.previewimages", true);
pref("extensions.adblockcash.data_directory", "adblockcash");
pref("extensions.adblockcash.whitelistschemes", "about chrome file irc moz-safe-about news resource snews x-jsd addbook cid imap mailbox nntp pop data javascript moz-icon");
pref("extensions.adblockcash.subscriptions_listurl", "https://adblockplus.org/subscriptions2.xml");
pref("extensions.adblockcash.composer_default", 2);
pref("extensions.adblockcash.clearStatsOnHistoryPurge", true);
pref("extensions.adblockcash.report_submiturl", false);
pref("extensions.adblockcash.recentReports", []);
pref("extensions.adblockcash.hideContributeButton", false);
pref("extensions.adblockcash.blockableItemsSize", {width: 200, height: 200});
pref("extensions.adblockcash.please_kill_startup_performance", false);
