/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

if (typeof chrome == "undefined") {
  var {Cm,Cc,Ci,Cr,Cu,components} = require("chrome");
}
let {Services} = Cu.import("resource://gre/modules/Services.jsm", null);
let {AddonManager} = Cu.import("resource://gre/modules/AddonManager.jsm");
let self = require("sdk/self");

let appInfo = Services.appinfo;

exports.addon = {
  id: self.id,
  name: "adblockcash",
  version: null,
  root: null,
  ready: new Promise((resolve) => {
    AddonManager.getAddonByID(self.id, (addon) => {
      exports.addon.version = addon.version;
      exports.addon.root = addon.getResourceURI("/").path;

      resolve(exports.addon);
    });
  })
};

exports.application = "firefox";
exports.applicationVersion = appInfo.version;

exports.platform = "gecko";
exports.platformVersion = appInfo.platformVersion;
