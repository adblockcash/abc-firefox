/*
 * This file is part of Adblock Cash <http://adblockcash.org/>,
 * (based on Adblock Plus <http://adblockplus.org/> by Eyeo GmbH)
 * Copyright (C) Adblock Cash
 *
 * Adblock Cash is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Cash is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Cash.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * @fileOverview Provides usage stats
 */

if (typeof chrome == "undefined") {
  var {Cm,Cc,Ci,Cr,Cu,components} = require("chrome");
}

let {Prefs} = require("./prefs");
let {BlockingFilter} = require("./filterClasses");
let {FilterNotifier} = require("./filterNotifier");
let {isWhitelisted} = require("./whitelisting");
let {AdblockCash} = require("./adblockCash");
let {PageMap, Pages} = require("./pages");

let badgeColor = "#646464";
let statsPerPage = new PageMap();

/**
 * Get statistics for specified page
 * @param  {String} key   field key
 * @param  {Page}   page  field page
 * @return {Number}       field value
 */
let getStats = exports.getStats = function getStats(key, page)
{
  if (!page)
    return Prefs.stats_total[key] || 0;

  let pageStats = statsPerPage.get(page);
  return pageStats ? (pageStats[key] || 0) : 0;
};

// Increment counts
function incrementFilterCounts(page, status) {
  Prefs.stats_total[status] = Prefs.stats_total[status] || 0;
  Prefs.stats_total[status]++;
  Prefs.stats_total = Prefs.stats_total;

  let pageStats = statsPerPage.get(page);
  if (!pageStats)
  {
    pageStats = {};
    statsPerPage.set(page, pageStats);
  }
  pageStats[status] = pageStats[status] || 0;
  pageStats[status]++;

  Prefs.stats_by_domain[page.domain] = Prefs.stats_by_domain[page.domain] || {};
  Prefs.stats_by_domain[page.domain][status] = Prefs.stats_by_domain[page.domain][status] || 0;
  Prefs.stats_by_domain[page.domain][status]++;
  Prefs.stats_by_domain = Prefs.stats_by_domain;
}

FilterNotifier.addListener(function(action, item, newValue, oldValue, page)
{
  Cu.reportError(JSON.stringify({action, page}));

  if (action != "filter.hitCount" || !page)
    return;

  let isPageWhitelisted = !!isWhitelisted(page.url);
  let isPageCashable = !!AdblockCash.isDomainCashable(page.domain);
  let adBlocked = item instanceof BlockingFilter && !isPageWhitelisted;
  let adWhitelisted = (item instanceof BlockingFilter && isPageWhitelisted) || item instanceof WhitelistFilter;

  if (!adBlocked && !adWhitelisted) {
    return;
  }

  if (adBlocked) {
    incrementFilterCounts(page, "blocked");
  }

  if (adWhitelisted) {
    incrementFilterCounts(page, "whitelisted");
  }

  if (!adBlocked && isPageCashable) {
    incrementFilterCounts(page, "earned");
  }

  if (adBlocked && isPageCashable) {
    incrementFilterCounts(page, "missed");
  }

  if (isPageCashable) {
    AdblockCash.sendVisitDetection(page.domain, isPageWhitelisted);
  }

  // Update number in icon
  if (Prefs.show_statsinicon && adBlocked)
  {
    page.browserAction.setBadge({
      color: badgeColor,
      number: statsPerPage.get(page).blocked
    });
  }
});

// Prefs.addListener(function(name)
// {
//   if (name != "show_statsinicon")
//     return;

//   Pages.query({}, function(pages)
//   {
//     for (var i = 0; i < pages.length; i++)
//     {
//       let page = pages[i];
//       let badge = null;

//       if (Prefs.show_statsinicon)
//       {
//         let pageStats = statsPerPage.get(page);
//         if (pageStats && "blocked" in pageStats)
//         {
//           badge = {
//             color: badgeColor,
//             number: pageStats.blocked
//           };
//         }
//       }

//       page.browserAction.setBadge(badge);
//     }
//   });
// });
