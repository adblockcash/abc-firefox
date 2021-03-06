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
 * @fileOverview Starts up Adblock Cash
 */

const {Cc,Ci,Cr,Cu,Cm,components} = require("chrome");
const {Services, atob, btoa, File, TextDecoder, TextEncoder} = Cu.import("resource://gre/modules/Services.jsm", null);
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
// let XMLHttpRequest = components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest");
const {XMLHttpRequest} = require("sdk/net/xhr");

const {addon} = require("./info");
const {onShutdown} = require("./utils");

exports.main = function startup(options, callbacks) {
  Services.obs.addObserver(RequireObserver, "adblockcash-require", true);
  onShutdown.add(function() {
    Services.obs.removeObserver(RequireObserver, "adblockcash-require")
  });

  // Clear extension's error log
  Cc["@mozilla.org/consoleservice;1"]
            .getService(Ci.nsIConsoleService)
            .reset();

  addon.ready.then(() => {
    require("./prefs");
    require("./filterListener");
    require("./contentPolicy");
    require("./synchronizer");
    require("./notification");
    require("./sync");
    require("./ui");

// TODO find a way to automatically ls all files from lib/ and require them
require("./adblockCash");
require("./adblockCashUtils");
require("./antiadblockInit");
require("./appSupport");
require("./browserUtils");
require("./contentPolicy");
require("./commonUtils");
require("./customizableUI");
require("./downloader");
require("./elemHide");
require("./elemHideHitRegistration");
require("./env");
require("./filterClasses");
require("./filterListener");
require("./filterNotifier");
require("./filterStorage");
require("./hooks");
require("./info");
require("./io");
require("./keySelector");
require("./main");
require("./matcher");
require("./notification");
require("./objectTabs");
require("./pages");
require("./prefs");
require("./requestNotifier");
require("./rollbar-shimload");
require("./stats");
require("./subscriptionClasses");
require("./sync");
require("./synchronizer");
require("./ui");
require("./utils");
require("./utilsUri");
require("./whitelisting");
require("./windowObserver");
  });
};

exports.onUnload = function shutdown(reason) {
  onShutdown.trigger();

  // // Make sure to release our ties to the modules even if the sandbox cannot be
  // // released for some reason.
  // for (let key in requireAbc.scopes) {
  //   let scope = requireAbc.scopes[key];
  //   let list = Object.keys(scope);
  //   for (let i = 0; i < list.length; i++)
  //     scope[list[i]] = null;
  // }
  // requireAbc.scopes = null;

  // Users often uninstall/reinstall extension to "fix" issues. Clear current
  // version number on uninstall to rerun first-run actions in this scenario.
  if (reason == "uninstall")
    Services.prefs.clearUserPref("extensions.adblockcash.currentVersion");
};


// function requireAbc(module) {
//   module = module.replace("./", "");
//   let scopes = requireAbc.scopes;
//   if (!(module in scopes)) {
//     let url = addon.root + "resources/abc-firefox/lib/" + module + ".js";
//     scopes[module] = {
//       Cc: Cc,
//       Ci: Ci,
//       Cr: Cr,
//       Cu: Cu,
//       atob: atob,
//       btoa: btoa,
//       File: File,
//       require: requireAbc,
//       onShutdown: onShutdown,
//       XMLHttpRequest: XMLHttpRequest,
//       exports: {}
//     };
//     // {%- if multicompartment %}
//     // let principal = Cc["@mozilla.org/systemprincipal;1"].getService(Ci.nsIPrincipal);
//     // scopes[module] = new Cu.Sandbox(principal, {
//     //   sandboxName: url,
//     //   sandboxPrototype: scopes[module],
//     //   wantXrays: false
//     // });
//     // {%- endif %}

//     Services.scriptloader.loadSubScript(url, scopes[module]);
//   }
//   return scopes[module].exports;
// }
// requireAbc.scopes = {__proto__: null};

let RequireObserver = {
  observe: function(subject, topic, data) {
    if (topic == "adblockcash-require") {
      try {
        subject.wrappedJSObject.exports = require(data);
      } catch(e) {
        subject.wrappedJSObject.exports = e;
        throw e;
      }
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};
