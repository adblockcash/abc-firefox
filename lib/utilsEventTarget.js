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

let EventTarget = exports._EventTarget = function(cancelable)
{
  this._listeners = [];
  this._cancelable = cancelable;
};
EventTarget.prototype = {
  addListener: function(listener)
  {
    if (this._listeners.indexOf(listener) == -1)
      this._listeners.push(listener);
  },
  removeListener: function(listener)
  {
    let idx = this._listeners.indexOf(listener);
    if (idx != -1)
      this._listeners.splice(idx, 1);
  },
  _dispatch: function()
  {
    let result = null;

    for (let i = 0; i < this._listeners.length; i++)
    {
      result = this._listeners[i].apply(null, arguments);

      if (this._cancelable && result === false)
        break;
    }

    return result;
  }
};
