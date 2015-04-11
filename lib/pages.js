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

if (typeof chrome == "undefined") {
  var {Cm,Cc,Ci,Cr,Cu,components} = require("chrome");

  // let {setTimeout, clearTimeout}
  Cu.import("resource://gre/modules/Timer.jsm");
}

let Utils = require("./utils");
let UriUtils = require("./utilsUri");
let {_EventTarget} = require("./utilsEventTarget");
const {onShutdown} = require("./utils");

onShutdown.add(function(){
  PageMap._removeFromAllPageMaps();
});


/* PageMap */

let PageMap = exports.PageMap = function()
{
  this._map = {__proto__: null};
  this._id = ++PageMap._pageMapCounter;
};

PageMap._nonEmptyPageMaps = {__proto__: null};
PageMap._pageMapCounter = 0;

PageMap.prototype = {
  _delete: function(id)
  {
    delete this._map[id];

    if (Object.keys(this._map).length == 0)
      delete _nonEmptyPageMaps[this._id];
  },
  get: function(page)
  {
    return this._map[page._id];
  },
  set: function(page, value)
  {
    this._map[page._id] = value;
    _nonEmptyPageMaps[this._id] = this;
  },
  has: function(page)
  {
    return page._id in this._map;
  },
  clear: function()
  {
    for (let id in this._map)
      this._delete(id);
  },
  delete: function(page)
  {
    this._delete(page._id);
  }
};

PageMap._removeFromAllPageMaps = function(pageId)
{
  for (let pageMapId in _nonEmptyPageMaps) {
    if (pageId) {
      _nonEmptyPageMaps[pageMapId]._delete(pageId);
    } else {
      _nonEmptyPageMaps[pageMapId].clear();
    }
  }
};


/* Page */

let Page = exports.Page = function(tab)
{
  this._id = tab.id;
  this._url = tab.url;

  this.browserAction = new BrowserAction(tab.id);
  this.contextMenus = new ContextMenus(this);
};
Page.prototype = {
  get url()
  {
    // usually our Page objects are created from Chrome's Tab objects, which
    // provide the url. So we can return the url given in the constructor.
    if (this._url != null)
      return this._url;

    // but sometimes we only have the tab id when we create a Page object.
    // In that case we get the url from top frame of the tab, recorded by
    // the onBeforeRequest handler.
    let frames = framesOfTabs[this._id];
    if (frames)
    {
      let frame = frames[0];
      if (frame)
        return frame.url;
    }
  },
  get domain()
  {
    let host = UriUtils.extractHostFromURL(this.url);
    // Drop the www. from the beginning
    host = host.replace(/^(?:www\.)?/, "");

    return host;
  },
  activate: function()
  {
    // chrome.tabs.update(this._id, {selected: true});
  },
  sendMessage: function(message, responseCallback)
  {
    // chrome.tabs.sendMessage(this._id, message, responseCallback);
  }
};


/* Pages */

let Pages = exports.Pages = {
  open: function(url, callback)
  {
    let chromeWindow = components.classes['@mozilla.org/appshell/window-mediator;1']
      .getService(components.interfaces.nsIWindowMediator)
      .getMostRecentWindow('navigator:browser');
    let newTab = chromeWindow.gBrowser.selectedTab = chromeWindow.gBrowser.addTab(url);
    let newTabBrowser = chromeWindow.gBrowser.getBrowserForTab(newTab);

    newTabBrowser.addEventListener("load", function onLoad(event){
      if (event.originalTarget instanceof components.interfaces.nsIDOMHTMLDocument) {
        let win = event.originalTarget.defaultView;
        if (win.frameElement) {
          // Frame within a tab was loaded.
          return;
        }
      }

      let document = event.target;
      let tabObject = {
        url: document.location.href
      };

      callback(new Page(tabObject));
      newTabBrowser.removeEventListener("load", onLoad);
    }, true);
  },

  // Opens the url,
  // and calls callback(tab.url) whenever the tab's url is being changed.
  //
  // If callback() returns true, we'll stop for listening the changes and close the tab.
  openAndListenForUrlChangesUntil: function (url, callback) {
    let chromeWindow = components.classes['@mozilla.org/appshell/window-mediator;1']
      .getService(components.interfaces.nsIWindowMediator)
      .getMostRecentWindow('navigator:browser');
    let newTab = chromeWindow.gBrowser.selectedTab = chromeWindow.gBrowser.addTab(url);
    let newTabBrowser = chromeWindow.gBrowser.getBrowserForTab(newTab);

    newTabBrowser.addEventListener("load", function onLoad(event){
      if (event.originalTarget instanceof components.interfaces.nsIDOMHTMLDocument) {
        let win = event.originalTarget.defaultView;
        if (win.frameElement) {
          // Frame within a tab was loaded.
          return;
        }
      }

      let document = event.target;
      let tabObject = {
        url: document.location.href
      };

      if (callback(tabObject.url) === true) {
        newTabBrowser.removeEventListener("load", onLoad);
        chromeWindow.gBrowser.removeTab(newTab);
      }
    }, true);
  },

  query: function(info, callback)
  {
    let rawInfo = {};
    for (let property in info)
    {
      switch (property)
      {
        case "active":
        case "lastFocusedWindow":
          rawInfo[property] = info[property];
      }
    }

    // chrome.tabs.query(rawInfo, function(tabs)
    // {
    //   callback(tabs.map(function(tab)
    //   {
    //     return new Page(tab);
    //   }));
    // });
  },

  getCurrentPage: function(callback)
  {
    let chromeWindow = components.classes['@mozilla.org/appshell/window-mediator;1']
      .getService(components.interfaces.nsIWindowMediator)
      .getMostRecentWindow('navigator:browser');
    let tab = chromeWindow.gBrowser.selectedTab;
    let tabBrowser = chromeWindow.gBrowser.getBrowserForTab(tab);
    let window = tabBrowser.contentWindow;

    callback(new Page({url: window.location.href}));
  },

  onLoading: new _EventTarget()
};

// chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab)
// {
//   if (changeInfo.status == "loading")
//     Pages.onLoading._dispatch(new Page(tab));
// });

// chrome.webNavigation.onBeforeNavigate.addListener(function(details)
// {
//   if (details.frameId == 0)
//     PageMap._removeFromAllPageMaps(details.tabId);
// });

// chrome.tabs.onRemoved.addListener(function(tabId)
// {
//   PageMap._removeFromAllPageMaps(tabId);
//   delete framesOfTabs[tabId];
// });


/* Browser actions */

let BrowserAction = function(tabId)
{
  this._tabId = tabId;
};
BrowserAction.prototype = {
  setIcon: function(path)
  {
    let paths = {};
    for (let i = 1; i <= 2; i++)
    {
      let size = i * 19;
      paths[size] = path.replace("$size", size);
    }

    // chrome.browserAction.setIcon({tabId: this._tabId, path: paths});
  },
  setBadge: function(badge)
  {
    if (!badge)
    {
      // chrome.browserAction.setBadgeText({
      //   tabId: this._tabId,
      //   text: ""
      // });
      return;
    }

    if ("color" in badge)
    {
      // chrome.browserAction.setBadgeBackgroundColor({
      //   tabId: this._tabId,
      //   color: badge.color
      // });
    }

    if ("number" in badge)
    {
      // chrome.browserAction.setBadgeText({
      //   tabId: this._tabId,
      //   text: badge.number.toString()
      // });
    }
  }
};


/* Context menus */

let contextMenuItems = new PageMap();
let contextMenuUpdating = false;

let updateContextMenu = function()
{
  if (contextMenuUpdating)
    return;

  contextMenuUpdating = true;

  // chrome.tabs.query({active: true, lastFocusedWindow: true}, function(tabs)
  // {
  //   chrome.contextMenus.removeAll(function()
  //   {
  //     contextMenuUpdating = false;

  //     if (tabs.length == 0)
  //       return;

  //     let items = contextMenuItems.get({_id: tabs[0].id});

  //     if (!items)
  //       return;

  //     items.forEach(function(item)
  //     {
  //       chrome.contextMenus.create({
  //         title: item.title,
  //         contexts: item.contexts,
  //         onclick: function(info, tab)
  //         {
  //           item.onclick(info.srcUrl, new Page(tab));
  //         }
  //       });
  //     });
  //   });
  // });
};

let ContextMenus = function(page)
{
  this._page = page;
};
ContextMenus.prototype = {
  create: function(item)
  {
    let items = contextMenuItems.get(this._page);
    if (!items)
      contextMenuItems.set(this._page, items = []);

    items.push(item);
    updateContextMenu();
  },
  removeAll: function()
  {
    contextMenuItems.delete(this._page);
    updateContextMenu();
  }
};

// chrome.tabs.onActivated.addListener(updateContextMenu);

// chrome.windows.onFocusChanged.addListener(function(windowId)
// {
//   if (windowId != chrome.windows.WINDOW_ID_NONE)
//     updateContextMenu();
// });


/* Web requests */

let framesOfTabs = {__proto__: null};

let getFrame = exports.getFrame = function getFrame(tabId, frameId)
{
  return (framesOfTabs[tabId] || {})[frameId];
};

let webRequest = exports.webRequest = {
  onBeforeRequest: new _EventTarget(true),
  // handlerBehaviorChanged: chrome.webRequest.handlerBehaviorChanged
};

// chrome.tabs.query({}, function(tabs)
// {
//   tabs.forEach(function(tab)
//   {
//     chrome.webNavigation.getAllFrames({tabId: tab.id}, function(details)
//     {
//       if (details && details.length > 0)
//       {
//         let frames = framesOfTabs[tab.id] = {__proto__: null};

//         for (let i = 0; i < details.length; i++)
//           frames[details[i].frameId] = {url: details[i].url, parent: null};

//         for (let i = 0; i < details.length; i++)
//         {
//           let parentFrameId = details[i].parentFrameId;

//           if (parentFrameId != -1)
//             frames[details[i].frameId].parent = frames[parentFrameId];
//         }
//       }
//     });
//   });
// });

// chrome.webRequest.onBeforeRequest.addListener(function(details)
// {
//   try
//   {
//     // the high-level code isn't interested in requests that aren't related
//     // to a tab and since those can only be handled in Chrome, we ignore
//     // them here instead of in the browser independent high-level code.
//     if (details.tabId == -1)
//       return;

//     let requestType = details.type;
//     let isMainFrame = requestType == "main_frame" || (

//       // assume that the first request belongs to the top frame. Chrome
//       // may give the top frame the type "object" instead of "main_frame".
//       // https://code.google.com/p/chromium/issues/detail?id=281711
//       details.frameId == 0 && !(details.tabId in framesOfTabs)
//     );

//     let frames = null;
//     if (!isMainFrame)
//       frames = framesOfTabs[details.tabId];
//     if (!frames)
//       frames = framesOfTabs[details.tabId] = {__proto__: null};

//     let frame = null;
//     if (!isMainFrame)
//     {
//       // we are looking for the frame that contains the element that
//       // is about to load, however if a frame is loading the surrounding
//       // frame is indicated by parentFrameId instead of frameId
//       let frameId;
//       if (requestType == "sub_frame")
//         frameId = details.parentFrameId;
//       else
//         frameId = details.frameId;

//       frame = frames[frameId] || frames[Object.keys(frames)[0]];

//       if (frame)
//       {
//         // Chrome 38 and 39 mistakenly reports requests of type 'object'
//         // (e.g. requests initiated by Flash) with the type 'other'.
//         // https://code.google.com/p/chromium/issues/detail?id=410382
//         if (requestType == "other" && / Chrome\/3[8-9]\b/.test(navigator.userAgent))
//           requestType = "object";

//         if (!webRequest.onBeforeRequest._dispatch(details.url, requestType, new Page({id: details.tabId}), frame))
//           return {cancel: true};
//       }
//     }

//     if (isMainFrame || details.type == "sub_frame")
//       frames[details.frameId] = {url: details.url, parent: frame};
//   }
//   catch (e)
//   {
//     // recent versions of Chrome cancel the request when an error occurs in
//     // the onBeforeRequest listener. However in our case it is preferred, to
//     // let potentially some ads through, rather than blocking legit requests.
//     console.error(e);
//   }
// }, {urls: ["http://*/*", "https://*/*"]}, ["blocking"]);


/* Message passing */

// chrome.runtime.onMessage.addListener(function(message, rawSender, sendResponse)
// {
//   let sender = {
//     page: new Page(rawSender.tab),
//     frame: {
//       url: rawSender.url,
//       get parent()
//       {
//         let frames = framesOfTabs[rawSender.tab.id];

//         if (!frames)
//           return null;

//         for (let frameId in frames)
//         {
//           if (frames[frameId].url == rawSender.url)
//             return frames[frameId].parent;
//         }

//         return frames[0];
//       }
//     }
//   };

//   return Utils.onMessage._dispatch(message, sender, sendResponse);
// });
