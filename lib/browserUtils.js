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

let {Utils, onShutdown} = require("./utils");
let {Pages} = require("./pages");
let {UI} = require("./ui");

/* crossbrowser helper methods */

exports.showOptions = function(callback) {
  let optionsUrl = Utils.getURL("shared/options.html");
  Pages.open(optionsUrl, callback);
};

exports.closePopup = function() {
  UI.popupPanel.hide();
};

exports.bindUpdateStateCallbackToWindow = function(window, callback) {
  UI.addUpdateWindowStateCallback(callback);
  window.addEventListener("unload", () => { UI.removeUpdateWindowStateCallback(callback) }, false);
  onShutdown.add(() => { UI.removeUpdateWindowStateCallback(callback) }, false);
}
