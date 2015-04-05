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

if (typeof chrome == "undefined")
  var {Cm,Cc,Ci,Cr,Cu,components} = require("chrome");
const {addon} = require("./info");
const {onShutdown} = require("./utils");

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

exports.main = (options, callbacks) => {
  addon.ready.then(() => {
    registerPublicAPI();
    require("./filterListener");
    require("./contentPolicy");
    require("./synchronizer");
    require("./notification");
    require("./sync");
    require("./ui");
  });
};

exports.onUnload = (reason) => {
  onShutdown.trigger();

  // Users often uninstall/reinstall extension to "fix" issues. Clear current
  // version number on uninstall to rerun first-run actions in this scenario.
  if (reason == "uninstall")
    Services.prefs.clearUserPref("extensions.adblockcash.currentVersion");
};

function registerPublicAPI()
{
  let uri = Services.io.newURI(addon.root + "lib/Public.jsm", null, null);
  if (uri instanceof Ci.nsIMutable)
    uri.mutable = false;

  let classID = components.ID("5e447bce-1dd2-11b2-b151-ec21c2b6a135");
  let contractID = "@adblockcash.org/abp/public;1";
  let factory =
  {
    createInstance: function(outer, iid)
    {
      if (outer)
        throw Cr.NS_ERROR_NO_AGGREGATION;
      return uri.QueryInterface(iid);
    },
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory])
  };

  let registrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);
  registrar.registerFactory(classID, "Adblock Cash public API URL", contractID, factory);

  onShutdown.add(function()
  {
    registrar.unregisterFactory(classID, factory);
    Cu.unload(uri.spec);
  });
}
