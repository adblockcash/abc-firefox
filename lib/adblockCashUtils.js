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

let {isWhitelisted} = require("./whitelisting");
let {AdblockCash} = require("./adblockCash");

let AdblockCashUtils = exports.AdblockCashUtils = {
  getAdblockStatus: function(page) {
    if (!page) {
      return "nonadblocked";
    }

    let isPageWhitelisted = isWhitelisted(page.url);
    let isCashable = !!AdblockCash.isDomainCashable(page.domain);

    switch(true) {
      case (isPageWhitelisted && isCashable):
        return "whitelisted";
      case (!isPageWhitelisted && isCashable):
        return "nonwhitelisted";
      case (!isPageWhitelisted && !isCashable):
        return "adblocked";
      case (isPageWhitelisted && !isCashable):
        return "nonadblocked";
    }
  }
};
