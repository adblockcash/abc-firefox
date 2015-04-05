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

if (typeof chrome == "undefined")
  var {Cm,Cc,Ci,Cr,Cu,components} = require("chrome");

let {Services} = Cu.import("resource://gre/modules/Services.jsm", null);

var {Policy} = require("./contentPolicy");
var {Filter, InvalidFilter, CommentFilter, ActiveFilter, RegExpFilter,
     BlockingFilter, WhitelistFilter, ElemHideBase, ElemHideFilter, ElemHideException} = require("./filterClasses");
var {FilterNotifier} = require("./filterNotifier");
var {FilterStorage, PrivateBrowsing} = require("./filterStorage");
var {IO} = require("./io");
var {defaultMatcher, Matcher, CombinedMatcher} = require("./matcher");
var {Prefs} = require("./prefs");
var {RequestNotifier} = require("./requestNotifier");
var {Subscription, SpecialSubscription, RegularSubscription,
     ExternalSubscription, DownloadableSubscription} = require("./subscriptionClasses");
var {Synchronizer} = require("./synchronizer");
var {UI} = require("./ui");
var {Utils} = require("./utils");

/**
 * Shortcut for document.getElementById(id)
 */
function E(id)
{
  return document.getElementById(id);
}

/**
 * Split up all labels into the label and access key portions.
 */
document.addEventListener("DOMContentLoaded", function splitAllLabelsHandler()
{
  document.removeEventListener("DOMContentLoaded", splitAllLabelsHandler, false);
  Utils.splitAllLabels(document);
}, false);
