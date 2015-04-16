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
  Cu.import("resource://gre/modules/Services.jsm");
  Cu.import("resource://gre/modules/XPCOMUtils.jsm");

  // var XMLHttpRequest = components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest");
  XMLHttpRequest = require("sdk/net/xhr").XMLHttpRequest;
}

let {Utils, onShutdown} = require("./utils");
let {Prefs} = require("./prefs");
let {Policy} = require("./contentPolicy");
let {FilterStorage} = require("./filterStorage");
let {FilterNotifier} = require("./filterNotifier");
let {RequestNotifier} = require("./requestNotifier");
let {Filter} = require("./filterClasses");
let {Subscription, SpecialSubscription, DownloadableSubscription} = require("./subscriptionClasses");
let {Synchronizer} = require("./synchronizer");
let {KeySelector} = require("./keySelector");
let {Notification} = require("./notification");
let {initAntiAdblockNotification} = require("./antiadblockInit");
let {AdblockCashUtils} = require("./adblockCashUtils");
let {Page} = require("./pages");

let { ToggleButton } = require('sdk/ui/button/toggle');
let panels = require("sdk/panel");
let self = require("sdk/self");

let CustomizableUI = null;

/**
 * Filter corresponding with "disable on site" menu item (set in fillIconMent()).
 * @type Filter
 */
let siteWhitelist = null;
/**
 * Filter corresponding with "disable on site" menu item (set in fillIconMenu()).
 * @type Filter
 */
let pageWhitelist = null;

/**
 * Window containing the detached list of blockable items.
 * @type Window
 */
let detachedBottombar = null;

/**
 * Object initializing add-on options, observes add-on manager notifications
 * about add-on options being opened.
 * @type nsIObserver
 */
let optionsObserver =
{
  init: function()
  {
    Services.obs.addObserver(this, "addon-options-displayed", true);
    onShutdown.add(function()
    {
      Services.obs.removeObserver(this, "addon-options-displayed");
    }.bind(this));
  },

  /**
   * Initializes options in add-on manager when they show up.
   */
  initOptionsDoc: function(/**Document*/ doc)
  {
    function hideElement(id, hide)
    {
      let element = doc.getElementById(id);
      if (element)
        element.collapsed = hide;
    }
    function setChecked(id, checked)
    {
      let element = doc.getElementById(id);
      if (element)
        element.value = checked;
    }
    function addCommandHandler(id, handler)
    {
      let element = doc.getElementById(id);
      if (element)
        element.addEventListener("command", handler, false);
    }

    Utils.splitAllLabels(doc);

    addCommandHandler("adblockcash-filters", UI.openFiltersDialog.bind(UI));

    let {Sync} = require("./sync");
    let syncEngine = Sync.getEngine();
    hideElement("adblockcash-sync", !syncEngine);

    let {defaultToolbarPosition, statusbarPosition} = require("./appSupport");
    let hasToolbar = defaultToolbarPosition;
    let hasStatusBar = statusbarPosition;

    hideElement("adblockcash-showintoolbar", !hasToolbar);
    hideElement("adblockcash-showinstatusbar", !hasStatusBar);

    let checkbox = doc.querySelector("setting[type=bool]");
    if (checkbox)
      initCheckboxes();

    function initCheckboxes()
    {
      if (!("value" in checkbox))
      {
        // XBL bindings didn't apply yet (bug 708397), try later
        Utils.runAsync(initCheckboxes);
        return;
      }

      setChecked("adblockcash-savestats", Prefs.savestats);
      addCommandHandler("adblockcash-savestats", function()
      {
        UI.toggleSaveStats(doc.defaultView);
        this.value = Prefs.savestats;
      });

      setChecked("adblockcash-sync", syncEngine && syncEngine.enabled);
      addCommandHandler("adblockcash-sync", function()
      {
        this.value = UI.toggleSync();
      });

      setChecked("adblockcash-showintoolbar", UI.isToolbarIconVisible());
      addCommandHandler("adblockcash-showintoolbar", function()
      {
        UI.toggleToolbarIcon();
        this.value = UI.isToolbarIconVisible();
      });

      let list = doc.getElementById("adblockcash-subscription-list");
      if (list)
      {
        // Load subscriptions data
        let request = new XMLHttpRequest();
        request.mozBackgroundRequest = true;
        request.open("GET", "chrome://adblockcash/content/shared/data/subscriptions.xml");
        request.addEventListener("load", function()
        {
          if (onShutdown.done)
            return;

          let currentSubscription = FilterStorage.subscriptions.filter((subscription) => subscription instanceof DownloadableSubscription);
          currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);

          let subscriptions =request.responseXML.getElementsByTagName("subscription");
          for (let i = 0; i < subscriptions.length; i++)
          {
            let item = subscriptions[i];
            let url = item.getAttribute("url");
            if (!url)
              continue;

            list.appendItem(item.getAttribute("title"), url, null);
            if (currentSubscription && url == currentSubscription.url)
              list.selectedIndex = list.itemCount - 1;

            if (currentSubscription && list.selectedIndex < 0)
            {
              list.appendItem(currentSubscription.title, currentSubscription.url, null);
              list.selectedIndex = list.itemCount - 1;
            }
          }

          var listener = function()
          {
            if (list.value)
              UI.setSubscription(list.value, list.label);
          };
          list.addEventListener("command", listener, false);

          // xul:menulist in Fennec is broken and doesn't trigger any events
          // on selection. Have to detect selectIndex changes instead.
          // See https://bugzilla.mozilla.org/show_bug.cgi?id=891736
          list.watch("selectedIndex", function(prop, oldval, newval)
          {
            Utils.runAsync(listener);
            return newval;
          });
        }, false);
        request.send();
      }
    }
  },

  observe: function(subject, topic, data)
  {
    let addonID = require("./info").addon.id;
    if (data != addonID)
      return;

    this.initOptionsDoc(subject.QueryInterface(Ci.nsIDOMDocument));
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};
optionsObserver.init();

/**
 * Session restore observer instance, stored to prevent it from being garbage
 * collected.
 * @type SessionRestoreObserver
 */
let sessionRestoreObserver = null;

/**
 * Observer waiting for the browsing session to be restored on startup.
 */
function SessionRestoreObserver(/**function*/ callback)
{
  sessionRestoreObserver = this;

  this.callback = callback;
  Services.obs.addObserver(this, "sessionstore-windows-restored", true);

  // Just in case, don't wait longer than 5 seconds
  this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  this.timer.init(this, 5000, Ci.nsITimer.TYPE_ONE_SHOT);
}
SessionRestoreObserver.prototype =
{
  callback: null,
  timer: null,
  observe: function(subject, topic, data)
  {
    Services.obs.removeObserver(this, "sessionstore-windows-restored");
    sessionRestoreObserver = null;

    this.timer.cancel();
    this.timer = null;

    if (!onShutdown.done)
      this.callback();
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};

/**
 * Timer used to delay notification handling.
 * @type nsITimer
 */
let notificationTimer = null;

let UI = exports.UI =
{
  /**
   * Gets called on startup, initializes UI integration.
   */
  init: function()
  {
    // We should call initDone once both overlay and filters are loaded
    let overlayLoaded = false;
    let filtersLoaded = false;
    let sessionRestored = false;

    // Start loading overlay
    let request = new XMLHttpRequest();
    request.mozBackgroundRequest = true;
    request.open("GET", "chrome://adblockcash/content/ui/overlay.xul");
    request.addEventListener("load", function(event)
    {
      if (onShutdown.done)
        return;

      this.processOverlay(request.responseXML.documentElement);

      // Don't wait for the rest of the startup sequence, add icon already
      this.addToolbarButton();

      overlayLoaded = true;
      if (overlayLoaded && filtersLoaded && sessionRestored)
        this.initDone();
    }.bind(this), false);
    request.send(null);

    // Wait for filters to load
    if (FilterStorage._loading)
    {
      let listener = function(action)
      {
        if (action != "load")
          return;

        FilterNotifier.removeListener(listener);
        filtersLoaded = true;
        if (overlayLoaded && filtersLoaded && sessionRestored)
          this.initDone();
      }.bind(this);
      FilterNotifier.addListener(listener);
    }
    else
      filtersLoaded = true;

    // Initialize UI after the session is restored
    let window = this.currentWindow;
    if (!window && "nsISessionStore" in Ci)
    {
      // No application windows yet, the application must be starting up. Wait
      // for session to be restored before initializing our UI.
      new SessionRestoreObserver(function()
      {
        sessionRestored = true;
        if (overlayLoaded && filtersLoaded && sessionRestored)
          this.initDone();
      }.bind(this));
    }
    else
      sessionRestored = true;
  },

  /**
   * Provesses overlay document data and initializes overlay property.
   */
  processOverlay: function(/**Element*/ root)
  {
    Utils.splitAllLabels(root);

    let specialElements = {"abc-status-popup": true, "abc-status": true, "abc-toolbarbutton": true, "abc-menuitem": true, "abc-bottombar-container": true};

    this.overlay = {all: []};

    // Remove whitespace text nodes
    let walker = root.ownerDocument.createTreeWalker(
      root, Ci.nsIDOMNodeFilter.SHOW_TEXT,
      (node) => !/\S/.test(node.nodeValue), false
    );
    let whitespaceNodes = [];
    while (walker.nextNode())
      whitespaceNodes.push(walker.currentNode);

    for (let i = 0; i < whitespaceNodes.length; i++)
      whitespaceNodes[i].parentNode.removeChild(whitespaceNodes[i]);

    // Put overlay elements into appropriate fields
    while (root.firstElementChild)
    {
      let child = root.firstElementChild;
      if (child.getAttribute("id") in specialElements)
        this.overlay[child.getAttribute("id")] = child;
      else
        this.overlay.all.push(child);
      root.removeChild(child);
    }

    // Read overlay attributes
    this.overlay.attributes = {};
    for (let i = 0; i < root.attributes.length; i++)
      this.overlay.attributes[root.attributes[i].name] = root.attributes[i].value;

    // Copy context menu into the toolbar icon and Tools menu item
    function fixId(element, newId)
    {
      if (element.hasAttribute("id"))
        element.setAttribute("id", element.getAttribute("id").replace("abc-status", newId));

      for (let i = 0, len = element.children.length; i < len; i++)
        fixId(element.children[i], newId);

      return element;
    }

    if ("abc-status-popup" in this.overlay)
    {
      let menuSource = this.overlay["abc-status-popup"];
      delete this.overlay["abc-status-popup"];

      if (this.overlay.all.length)
        this.overlay.all[0].appendChild(menuSource);
      if ("abc-toolbarbutton" in this.overlay)
        this.overlay["abc-toolbarbutton"].appendChild(fixId(menuSource.cloneNode(true), "abc-toolbar"));
      if ("abc-menuitem" in this.overlay)
        this.overlay["abc-menuitem"].appendChild(fixId(menuSource.cloneNode(true), "abc-menuitem"));
    }
  },

  /**
   * Gets called once the initialization is finished and Adblock Cash elements
   * can be added to the UI.
   */
  initDone: function()
  {
    // The icon might be added already, make sure its state is correct
    this.updateState();

    // Listen for pref and filters changes
    Prefs.addListener(function(name)
    {
      if (name == "enabled" || name == "defaulttoolbaraction" || name == "defaultstatusbaraction")
        this.updateState();
      else if (name == "showinstatusbar")
      {
        for (let window in this.applicationWindows)
          this.updateStatusbarIcon(window);
      }
    }.bind(this));
    FilterNotifier.addListener(function(action)
    {
      if (/^(filter|subscription)\.(added|removed|disabled|updated)$/.test(action) || action == "load")
        this.updateState();
    }.bind(this));

    notificationTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    notificationTimer.initWithCallback(this.showNextNotification.bind(this),
                                       3 * 60 * 1000, Ci.nsITimer.TYPE_ONE_SHOT);
    onShutdown.add(() => notificationTimer.cancel());

    // Add "anti-adblock messages" notification
    initAntiAdblockNotification();

    let documentCreationObserver = {
      observe: function(subject, topic, data)
      {
        if (!(subject instanceof Ci.nsIDOMWindow))
          return;

        this.showNextNotification(subject.location.href);
      }.bind(UI)
    };
    Services.obs.addObserver(documentCreationObserver, "content-document-global-created", false);
    onShutdown.add(function()
    {
      Services.obs.removeObserver(documentCreationObserver, "content-document-global-created", false);
    });

    // Execute first-run actions if a window is open already, otherwise it
    // will happen in applyToWindow() when a window is opened.
    this.firstRunActions(this.currentWindow);
  },

  addToolbarButton: function()
  {
    let {WindowObserver} = require("./windowObserver");
    new WindowObserver(this);

    let toolbarButton = this.toolbarButton = ToggleButton({
      id: "abc-toolbarbutton",
      label: "Adblock Ca$h",
      icon: {
        "16": "chrome://adblockcash/skin/abc-status-16-red.png",
        "32": "chrome://adblockcash/skin/abc-status-32-red.png"
      },
      onChange: handleChange
    });

    let popupPanel = this.popupPanel = panels.Panel({
      contentURL: Utils.getURL("shared/popup.html"),
      contentScript: "function resize(){ self.port.emit('resize', {width: document.body.getBoundingClientRect().width, height: document.body.getBoundingClientRect().height}); }; self.port.on('show', resize); resize()"
    });

    popupPanel.on("hide", function() {
      toolbarButton.state('window', {checked: false});
    });

    popupPanel.on("show", function(){
      popupPanel.port.emit("show");
    });

    popupPanel.port.on("resize", function({width, height}) {
      popupPanel.resize(width, height);
    });

    function handleChange(state) {
      if (state.checked) {
        popupPanel.show({
          position: toolbarButton
        });
      }
    }
  },

  firstRunActions: function(window)
  {
    if (this.firstRunDone || !window || FilterStorage._loading)
      return;

    this.firstRunDone = true;

    let {addon} = require("./info");
    let prevVersion = Prefs.currentVersion;
    if (prevVersion != addon.version)
    {
      Prefs.currentVersion = addon.version;
      this.addSubscription(window, prevVersion);
    }
  },

  /**
   * Will be set to true after the check whether first-run actions should run
   * has been performed.
   * @type Boolean
   */
  firstRunDone: false,

  /**
   * Initializes Adblock Cash UI in a window.
   */
  applyToWindow: function(/**Window*/ window, /**Boolean*/ noDelay)
  {
    let {delayInitialization, isKnownWindow, getBrowser, addBrowserLocationListener, addBrowserClickListener} = require("./appSupport");
    if (window.document.documentElement.id == "CustomizeToolbarWindow" || isKnownWindow(window))
    {
      // Add style processing instruction
      let style = window.document.createProcessingInstruction("xml-stylesheet", 'class="adblockcash-node" href="chrome://adblockcash/skin/overlay.css" type="text/css"');
      window.document.insertBefore(style, window.document.firstChild);
    }

    if (!isKnownWindow(window))
      return;

    // Thunderbird windows will not be initialized at this point, execute
    // delayed
    if (!noDelay && delayInitialization)
    {
      Utils.runAsync(this.applyToWindow.bind(this, window, true));
      return;
    }

    // Add general items to the document
    for (let i = 0; i < this.overlay.all.length; i++)
      window.document.documentElement.appendChild(this.overlay.all[i].cloneNode(true));

    // Add status bar icon
    this.updateStatusbarIcon(window);

    // Add tools menu item
    if ("abc-menuitem" in this.overlay)
    {
      let {toolsMenu} = require("./appSupport");
      let [parent, before] = this.resolveInsertionPoint(window, toolsMenu);
      if (parent)
        parent.insertBefore(this.overlay["abc-menuitem"].cloneNode(true), before);
    }

    // Attach event handlers
    for (let i = 0; i < eventHandlers.length; i++)
    {
      let [id, event, handler] = eventHandlers[i];
      let element = window.document.getElementById(id);
      if (element)
        element.addEventListener(event, handler.bind(null, window), false);
    }
    window.addEventListener("popupshowing", this.onPopupShowing, false);
    window.addEventListener("keypress", this.onKeyPress, false);

    addBrowserLocationListener(window, function()
    {
      this.updateWindowState(window);
    }.bind(this));
    addBrowserClickListener(window, this.onBrowserClick.bind(this, window));

    window.document.getElementById("abc-notification-close").addEventListener("command", function(event)
    {
      window.document.getElementById("abc-notification").hidePopup();
    }, false);

    // First-run actions?
    this.firstRunActions(window);

    // Some people actually switch off browser.frames.enabled and are surprised
    // that things stop working...
    window.QueryInterface(Ci.nsIInterfaceRequestor)
          .getInterface(Ci.nsIWebNavigation)
          .QueryInterface(Ci.nsIDocShell)
          .allowSubframes = true;
  },

  /**
   * Removes Adblock Cash UI from a window.
   */
  removeFromWindow: function(/**Window*/ window)
  {
    let {isKnownWindow, removeBrowserLocationListeners, removeBrowserClickListeners} = require("./appSupport");
    if (window.document.documentElement.id == "CustomizeToolbarWindow" || isKnownWindow(window))
    {
      // Remove style processing instruction
      for (let child = window.document.firstChild; child; child = child.nextSibling)
        if (child.nodeType == child.PROCESSING_INSTRUCTION_NODE && child.data.indexOf("adblockcash-node") >= 0)
          child.parentNode.removeChild(child);
    }

    if (!isKnownWindow(window))
      return;

    for (let id in this.overlay)
    {
      if (id == "all")
      {
        let list = this.overlay[id];
        for (let i = 0; i < list.length; i++)
        {
          let clone = window.document.getElementById(list[i].getAttribute("id"));
          if (clone)
            clone.parentNode.removeChild(clone);
        }
      }
      else
      {
        let clone = window.document.getElementById(id);
        if (clone)
          clone.parentNode.removeChild(clone);
      }
    }

    window.removeEventListener("popupshowing", this.onPopupShowing, false);
    window.removeEventListener("keypress", this.onKeyPress, false);
    removeBrowserLocationListeners(window);
    removeBrowserClickListeners(window);
  },

  /**
   * The overlay information to be used when adding elements to the UI.
   * @type Object
   */
  overlay: null,

  /**
   * Iterator for application windows that Adblock Cash should apply to.
   * @type Iterator
   */
  get applicationWindows()
  {
    let {isKnownWindow} = require("./appSupport");

    let enumerator = Services.wm.getZOrderDOMWindowEnumerator(null, true);
    if (!enumerator.hasMoreElements())
    {
      // On Linux the list returned will be empty, see bug 156333. Fall back to random order.
      enumerator = Services.wm.getEnumerator(null);
    }
    while (enumerator.hasMoreElements())
    {
      let window = enumerator.getNext().QueryInterface(Ci.nsIDOMWindow);
      if (isKnownWindow(window))
        yield window;
    }
  },

  /**
   * Returns the top-most application window or null if none exists.
   * @type Window
   */
  get currentWindow()
  {
    for (let window of this.applicationWindows)
      return window;
    return null;
  },

  /**
   * Opens a URL in the browser window. If browser window isn't passed as parameter,
   * this function attempts to find a browser window. If an event is passed in
   * it should be passed in to the browser if possible (will e.g. open a tab in
   * background depending on modifiers keys).
   */
  loadInBrowser: function(/**String*/ url, /**Window*/ currentWindow, /**Event*/ event)
  {
    if (!currentWindow)
      currentWindow = this.currentWindow;

    let {addTab} = require("./appSupport");
    if (currentWindow && addTab)
      addTab(currentWindow, url, event);
    else
    {
      let protocolService = Cc["@mozilla.org/uriloader/external-protocol-service;1"].getService(Ci.nsIExternalProtocolService);
      protocolService.loadURI(Services.io.newURI(url, null, null), null);
    }
  },

  /**
   * Opens a pre-defined documentation link in the browser window. This will
   * send the UI language to adblockcash.org so that the correct language
   * version of the page can be selected.
   */
  loadDocLink: function(/**String*/ linkID, /**Window*/ window)
  {
    let link = Utils.getDocLink(linkID);
    this.loadInBrowser(link, window);
  },


  /**
   * Brings up the filter composer dialog to block an item.
   */
  blockItem: function(/**Window*/ window, /**Node*/ node, /**RequestEntry*/ item)
  {
    if (!item)
      return;

    window.openDialog("chrome://adblockcash/content/ui/composer.xul", "_blank", "chrome,centerscreen,resizable,dialog=no,dependent", [node], item);
  },

  /**
   * Opens filter preferences dialog or focuses an already open dialog.
   * @param {Filter} [filter]  filter to be selected
   */
  openFiltersDialog: function(filter)
  {
    let existing = Services.wm.getMostRecentWindow("abp:filters");
    if (existing)
    {
      try
      {
        existing.focus();
      } catch (e) {}
      if (filter)
        existing.SubscriptionActions.selectFilter(filter);
    }
    else
    {
      Services.ww.openWindow(null, "chrome://adblockcash/content/ui/filters.xul", "_blank", "chrome,centerscreen,resizable,dialog=no", {wrappedJSObject: filter});
    }
  },

  /**
   * Opens report wizard for the current page.
   */
  openReportDialog: function(/**Window*/ window)
  {
    let wnd = Services.wm.getMostRecentWindow("abp:sendReport");
    if (wnd)
      wnd.focus();
    else
    {
      let uri = this.getCurrentLocation(window);
      if (uri)
      {
        let {getBrowser} = require("./appSupport");
        window.openDialog("chrome://adblockcash/content/ui/sendReport.xul", "_blank", "chrome,centerscreen,resizable=no", getBrowser(window).contentWindow, uri);
      }
    }
  },

  /**
   * Opens our contribution page.
   */
  openContributePage: function(/**Window*/ window)
  {
    this.loadDocLink("contribute", window);
  },

  /**
   * Executed on first run, adds a filter subscription and notifies that user
   * about that.
   */
  addSubscription: function(/**Window*/ window, /**String*/ prevVersion)
  {
    let privacySubscriptions = {
      "https://easylist-downloads.adblockplus.org/easyprivacy+easylist.txt": true,
      "https://easylist-downloads.adblockplus.org/easyprivacy.txt": true,
      "https://secure.fanboy.co.nz/fanboy-tracking.txt": true,
      "https://fanboy-adblock-list.googlecode.com/hg/fanboy-adblocklist-stats.txt": true,
      "https://bitbucket.org/fanboy/fanboyadblock/raw/tip/fanboy-adblocklist-stats.txt": true,
      "https://hg01.codeplex.com/fanboyadblock/raw-file/tip/fanboy-adblocklist-stats.txt": true,
      "https://adversity.googlecode.com/hg/Adversity-Tracking.txt": true
    };

    // Don't add subscription if the user has a subscription already
    let addSubscription = true;
    if (FilterStorage.subscriptions.some((subscription) => subscription instanceof DownloadableSubscription))
      addSubscription = false;

    // If this isn't the first run, only add subscription if the user has no custom filters
    if (addSubscription && Services.vc.compare(prevVersion, "0.0") > 0)
    {
      if (FilterStorage.subscriptions.some((subscription) => subscription.filters.length))
        addSubscription = false;
    }

    // Add "anti-adblock messages" subscription for new users and users updating from old ABP versions
    if (Services.vc.compare(prevVersion, "2.5") < 0)
    {
      let subscription = Subscription.fromURL(Prefs.subscriptions_antiadblockurl);
      if (subscription && !(subscription.url in FilterStorage.knownSubscriptions))
      {
        subscription.disabled = true;
        FilterStorage.addSubscription(subscription);
        if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
          Synchronizer.execute(subscription);
      }
    }

    if (!addSubscription)
      return;

    function notifyUser()
    {
      let {addTab} = require("./appSupport");
      if (addTab)
      {
        addTab(window, Utils.getURL("shared/firstRun.html"));
      }
      else
      {
        let dialogSource = '\
          <?xml-stylesheet href="chrome://global/skin/" type="text/css"?>\
          <dialog xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" onload="document.title=content.document.title" buttons="accept" width="500" height="600">\
            <iframe type="content-primary" flex="1" src="chrome://adblockcash/content/shared/firstRun.html"/>\
          </dialog>';
        Services.ww.openWindow(window,
                               "data:application/vnd.mozilla.xul+xml," + encodeURIComponent(dialogSource),
                               "_blank", "chrome,centerscreen,resizable,dialog=no", null);
      }
    }

    if (addSubscription)
    {
      // Add tracking filter list by default
      let subscription = Subscription.fromURL(Prefs.subscriptions_tracking_url);
      if (subscription) {
        subscription.title = Prefs.subscriptions_tracking_title;
        FilterStorage.addSubscription(subscription);
        if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
          Synchronizer.execute(subscription);
      }

      // Load subscriptions data,
      // and add a preferred filter subscription for the current locale
      let request = new XMLHttpRequest();
      request.mozBackgroundRequest = true;
      request.open("GET", "chrome://adblockcash/content/shared/data/subscriptions.xml");
      request.addEventListener("load", function()
      {
        if (onShutdown.done)
          return;

        let node = Utils.chooseFilterSubscription(request.responseXML.getElementsByTagName("subscription"));
        let subscription = (node ? Subscription.fromURL(node.getAttribute("url")) : null);
        if (subscription)
        {
          FilterStorage.addSubscription(subscription);
          subscription.disabled = false;
          subscription.title = node.getAttribute("title");
          subscription.homepage = node.getAttribute("homepage");
          if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
            Synchronizer.execute(subscription);

          notifyUser();
        }
      }, false);
      request.send();
    }
    else
      notifyUser();
  },

  /**
   * Handles clicks inside the browser's content area, will intercept clicks on
   * abp: links. This can be called either with an event object or with the link
   * target (if it is the former then link target will be retrieved from event
   * target).
   */
  onBrowserClick: function (/**Window*/ window, /**Event*/ event, /**String*/ linkTarget)
  {
    if (event)
    {
      // Ignore right-clicks
      if (event.button == 2)
        return;

      // Search the link associated with the click
      let link = event.target;
      while (link && !(link instanceof Ci.nsIDOMHTMLAnchorElement))
        link = link.parentNode;

      if (!link || link.protocol != "abp:")
        return;

      // This is our link - make sure the browser doesn't handle it
      event.preventDefault();
      event.stopPropagation();

      linkTarget = link.href;
    }

    let match = /^abp:\/*subscribe\/*\?(.*)/i.exec(linkTarget);
    if (!match)
      return;

    // Decode URL parameters
    let title = null;
    let url = null;
    let mainSubscriptionTitle = null;
    let mainSubscriptionURL = null;
    for (let param of match[1].split('&'))
    {
      let parts = param.split("=", 2);
      if (parts.length != 2 || !/\S/.test(parts[1]))
        continue;
      switch (parts[0])
      {
        case "title":
          title = decodeURIComponent(parts[1]);
          break;
        case "location":
          url = decodeURIComponent(parts[1]);
          break;
        case "requiresTitle":
          mainSubscriptionTitle = decodeURIComponent(parts[1]);
          break;
        case "requiresLocation":
          mainSubscriptionURL = decodeURIComponent(parts[1]);
          break;
      }
    }
    if (!url)
      return;

    // Default title to the URL
    if (!title)
      title = url;

    // Main subscription needs both title and URL
    if (mainSubscriptionTitle && !mainSubscriptionURL)
      mainSubscriptionTitle = null;
    if (mainSubscriptionURL && !mainSubscriptionTitle)
      mainSubscriptionURL = null;

    // Trim spaces in title and URL
    title = title.replace(/^\s+/, "").replace(/\s+$/, "");
    url = url.replace(/^\s+/, "").replace(/\s+$/, "");
    if (mainSubscriptionURL)
    {
      mainSubscriptionTitle = mainSubscriptionTitle.replace(/^\s+/, "").replace(/\s+$/, "");
      mainSubscriptionURL = mainSubscriptionURL.replace(/^\s+/, "").replace(/\s+$/, "");
    }

    // Verify that the URL is valid
    url = Utils.makeURI(url);
    if (!url || (url.scheme != "http" && url.scheme != "https" && url.scheme != "ftp"))
      return;
    url = url.spec;

    if (mainSubscriptionURL)
    {
      mainSubscriptionURL = Utils.makeURI(mainSubscriptionURL);
      if (!mainSubscriptionURL || (mainSubscriptionURL.scheme != "http" && mainSubscriptionURL.scheme != "https" && mainSubscriptionURL.scheme != "ftp"))
        mainSubscriptionURL = mainSubscriptionTitle = null;
      else
        mainSubscriptionURL = mainSubscriptionURL.spec;
    }

    this.openSubscriptionDialog(window, url, title, mainSubscriptionURL, mainSubscriptionTitle);
  },

  /**
   * Opens a dialog letting the user confirm/adjust a filter subscription to
   * be added.
   */
  openSubscriptionDialog: function(/**Window*/ window, /**String*/ url, /**String*/ title, /**String*/ mainURL, /**String*/ mainTitle)
  {
    let subscription = {url: url, title: title, disabled: false, external: false,
                        mainSubscriptionTitle: mainTitle, mainSubscriptionURL: mainURL};
    window.openDialog("chrome://adblockcash/content/ui/subscriptionSelection.xul", "_blank",
                      "chrome,centerscreen,resizable,dialog=no", subscription, null);
  },

  /**
   * Retrieves the current location of the browser.
   */
  getCurrentLocation: function(/**Window*/ window) /**nsIURI*/
  {
    let {getCurrentLocation} = require("./appSupport");
    let result = getCurrentLocation(window);
    return (result ? Utils.unwrapURL(result) : null);
  },

  /**
   * Retrieves the current location of the browser.
   */
  getCurrentPage: function(/**Window*/ window) /**nsIURI*/
  {
    let location = this.getCurrentLocation(window);
    if (location) {
      return new Page({url: location.spec});
    }
  },

  /**
   * Looks up an element with given ID in the window. If a list of IDs is given
   * will try all of them until an element exists.
   */
  findElement: function(/**Window*/ window, /**String|String[]*/ id) /**Element*/
  {
    if (id instanceof Array)
    {
      for (let candidate of id)
      {
        let result = window.document.getElementById(candidate);
        if (result)
          return result;
      }
      return null;
    }
    else
      return window.document.getElementById(id);
  },

  /**
   * Resolves an insertion point as specified in appSupport module. Returns
   * two elements: the parent element and the element to insert before.
   */
  resolveInsertionPoint: function(/**Window*/ window, /**Object*/ insertionPoint) /**Element[]*/
  {
    let parent = null;
    let before = null;
    if (insertionPoint)
    {
      if ("parent" in insertionPoint)
        parent = this.findElement(window, insertionPoint.parent);

      if (parent && "before" in insertionPoint)
        before = this.findElement(window, insertionPoint.before);

      if (parent && !before && "after" in insertionPoint)
      {
        let after = this.findElement(window, insertionPoint.after);
        if (after)
          before = after.nextElementSibling;
      }

      if (before && before.parentNode != parent)
        before = null;
    }

    return [parent, before];
  },

  /**
   * Toggles visibility state of the toolbar icon.
   */
  toggleToolbarIcon: function()
  {
    if (!CustomizableUI)
      return;
    if (this.isToolbarIconVisible())
      CustomizableUI.removeWidgetFromArea("abc-toolbarbutton");
    else
    {
      let {defaultToolbarPosition} = require("./appSupport");
      CustomizableUI.addWidgetToArea("abc-toolbarbutton", defaultToolbarPosition.parent);
    }
  },

  /**
   * Updates Adblock Cash icon state for all windows.
   */
  updateState: function()
  {
    for (let window in this.applicationWindows)
    {
      this.updateWindowState(window);
    }
  },

  /**
   * Updates Adblock Cash icon state for given window.
   */
  updateWindowState: function(window)
  {
    this.updateIconState(window, window.document.getElementById("abc-status"));
    this.updateIconState(window, this.toolbarButton);

    if (this._updateWindowStateCallbacks) {
      for (callback of this._updateWindowStateCallbacks) {
        callback();
      }
    }
  },

  addUpdateWindowStateCallback: function(callback)
  {
    this._updateWindowStateCallbacks = this._updateWindowStateCallbacks || [];
    this._updateWindowStateCallbacks.push(callback);
  },

  removeUpdateWindowStateCallback: function(callback)
  {
    if (!this._updateWindowStateCallbacks) {
      return;
    }

    let i = this._updateWindowStateCallbacks.indexOf(callback);
    if (i >= 0) {
      this._updateWindowStateCallbacks.splice(i);
    }
  },

  /**
   * Updates Adblock Cash icon state for a single application window.
   */
  updateIconState: function(/**Window*/ window, /**Element*/ icon)
  {
    if (!icon)
      return;

    let state = AdblockCashUtils.getAdblockStatus(this.getCurrentPage(window));

    if (icon == this.toolbarButton) {
      let color = "red";
      switch(state) {
        case "adblocked":
          color = "red";
          break;
        case "nonadblocked":
          color = "gray";
          break;
        case "whitelisted":
          color = "green";
          break;
        case "nonwhitelisted":
          color = "yellow";
          break;
      }

      this.toolbarButton.icon = {
        "16": "chrome://adblockcash/skin/abc-status-16-"+ color + ".png",
        "32": "chrome://adblockcash/skin/abc-status-32-"+ color + ".png"
      };

      return;
    }

    let popupId = "abc-status-popup";
    if (icon.localName == "statusbarpanel")
    {
      if (Prefs.defaultstatusbaraction == 0)
      {
        icon.setAttribute("popup", popupId);
        icon.removeAttribute("context");
      }
      else
      {
        icon.removeAttribute("popup");
        icon.setAttribute("context", popupId);
      }
    }
    else
    {
      if (Prefs.defaulttoolbaraction == 0)
      {
        icon.setAttribute("type", "menu");
        icon.removeAttribute("context");
      }
      else
      {
        icon.setAttribute("type", "menu-button");
        icon.setAttribute("context", popupId);
      }
    }

    icon.setAttribute("abcstate", state);
  },

  /**
   * Shows or hides status bar icons in all windows, according to pref.
   */
  updateStatusbarIcon: function(/**Window*/ window)
  {
    if (!("abc-status" in this.overlay))
      return;

    let {statusbarPosition} = require("./appSupport");
    if (!statusbarPosition)
      return;

    let icon = window.document.getElementById("abc-status");
    if (Prefs.showinstatusbar && !icon)
    {
      let [parent, before] = this.resolveInsertionPoint(window, statusbarPosition);
      if (!parent)
        return;

      parent.insertBefore(this.overlay["abc-status"].cloneNode(true), before);

      icon = window.document.getElementById("abc-status");
      this.updateIconState(window, icon);
      icon.addEventListener("click", this.onIconClick, false);
    }
    else if (!Prefs.showinstatusbar && icon)
      icon.parentNode.removeChild(icon);
  },

  /**
   * Toggles the value of a boolean preference.
   */
  togglePref: function(/**String*/ pref)
  {
    Prefs[pref] = !Prefs[pref];
  },

  /**
   * If the given filter is already in user's list, removes it from the list. Otherwise adds it.
   */
  toggleFilter: function(/**Filter*/ filter)
  {
    if (filter.subscriptions.length)
    {
      if (filter.disabled || filter.subscriptions.some((subscription) => !(subscription instanceof SpecialSubscription)))
        filter.disabled = !filter.disabled;
      else
        FilterStorage.removeFilter(filter);
    }
    else
      FilterStorage.addFilter(filter);
  },


  /**
   * Toggles "Count filter hits" option.
   */
  toggleSaveStats: function(window)
  {
    if (Prefs.savestats)
    {
      if (!Utils.confirm(window, Utils.getString("clearStats_warning")))
        return;

      FilterStorage.resetHitCounts();
      Prefs.savestats = false;
    }
    else
      Prefs.savestats = true;
  },

  /**
   * Sets the current filter subscription in a single-subscription scenario,
   * all other subscriptions will be removed.
   */
  setSubscription: function(url, title)
  {
    let subscription = Subscription.fromURL(url);
    let currentSubscriptions = FilterStorage.subscriptions.filter(
      ((subscription) => subscription instanceof DownloadableSubscription)
    );
    if (!subscription || currentSubscriptions.indexOf(subscription) >= 0)
      return;

    for (let i = 0; i < currentSubscriptions.length; i++)
      FilterStorage.removeSubscription(currentSubscriptions[i]);

    subscription.title = title;
    FilterStorage.addSubscription(subscription);
    if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
      Synchronizer.execute(subscription);
  },

  /**
   * Toggles the pref for the Adblock Cash sync engine.
   * @return {Boolean} new state of the sync engine
   */
  toggleSync: function()
  {
    let {Sync} = require("./sync");
    let syncEngine = Sync.getEngine();
    if (syncEngine)
    {
      syncEngine.enabled = !syncEngine.enabled;
      return syncEngine.enabled;
    }
    else
      return false;
  },

  /**
   * Tests whether blockable items list is currently open.
   */
  isBottombarOpen: function(/**Window*/ window) /**Boolean*/
  {
    if (detachedBottombar && !detachedBottombar.closed)
      return true;

    return !!window.document.getElementById("abc-bottombar");
  },

  /**
   * Called when some pop-up in the application window shows up, initializes
   * pop-ups related to Adblock Cash.
   */
  onPopupShowing: function(/**Event*/ event)
  {
    if (event.defaultPrevented)
      return;

    let popup = event.originalTarget;

    let {contentContextMenu} = require("./appSupport");
    if ((typeof contentContextMenu == "string" && popup.id == contentContextMenu) ||
        (contentContextMenu instanceof Array && contentContextMenu.indexOf(popup.id) >= 0))
    {
      this.fillContentContextMenu(popup);
    }
    else if (popup.id == "abc-tooltip")
      this.fillIconTooltip(event, popup.ownerDocument.defaultView);
    else
    {
      let match = /^(abc-(?:toolbar|status|menuitem)-)popup$/.exec(popup.id);
      if (match)
        this.fillIconMenu(event, popup.ownerDocument.defaultView, match[1]);
    }
  },

  /**
   * Handles click on toolbar and status bar icons.
   */
  onIconClick: function(/**Event*/ event)
  {
    if (event.eventPhase != event.AT_TARGET)
      return;

    let isToolbar = (event.target.localName != "statusbarpanel");
    let action = 0;
    if ((isToolbar && event.type == "command") || (!isToolbar && event.button == 0))
      action = (isToolbar ? Prefs.defaulttoolbaraction : Prefs.defaultstatusbaraction);
    else if (event.button == 1)
      action = 3;

    let window = event.target.ownerDocument.defaultView;
    if (action == 1)
      this.toggleBottombar(window);
    else if (action == 2)
      this.openFiltersDialog();
    else if (action == 3)
    {
      // If there is a whitelisting rule for current page - remove it (reenable).
      // Otherwise flip "enabled" pref.
      if (!this.removeWhitelist(window))
        this.togglePref("enabled");
    }
  },

  /**
   * Removes/disables the exception rule applying for the current page.
   */
  removeWhitelist: function(/**Window*/ window)
  {
    let location = this.getCurrentLocation(window);
    let filter = null;
    if (location)
      filter = require("./contentPolicy").Policy.isWhitelisted(location.spec);
    if (filter && filter.subscriptions.length && !filter.disabled)
    {
      UI.toggleFilter(filter);
      return true;
    }
    return false;
  },

  /**
   * Updates state of the icon tooltip.
   */
  fillIconTooltip: function(/**Event*/ event, /**Window*/ window)
  {
    let E = (id) => window.document.getElementById(id);

    let node = window.document.tooltipNode;
    if (!node || !node.hasAttribute("tooltip"))
    {
      event.preventDefault();
      return;
    }

    // Prevent tooltip from overlapping menu
    for (let id of ["abc-toolbar-popup", "abc-status-popup"])
    {
      let element = E(id);
      if (element && element.state == "open")
      {
        event.preventDefault();
        return;
      }
    }

    let type = (node.id == "abc-toolbarbutton" ? "toolbar" : "statusbar");
    let action = parseInt(Prefs["default" + type + "action"]);
    if (isNaN(action))
      action = -1;

    let actionDescr = E("abc-tooltip-action");
    actionDescr.hidden = (action < 0 || action > 3);
    if (!actionDescr.hidden)
      actionDescr.setAttribute("value", Utils.getString("action" + action + "_tooltip"));

    let statusDescr = E("abc-tooltip-status");
    let state = node.getAttribute("abcstate");
    let statusStr = Utils.getString(state + "_tooltip");
    if (state == "active")
    {
      let [activeSubscriptions, activeFilters] = FilterStorage.subscriptions.reduce(function([subscriptions, filters], current)
      {
        if (current instanceof SpecialSubscription)
          return [subscriptions, filters + current.filters.filter((filter) => !filter.disabled).length];
        else if (!current.disabled)
          return [subscriptions + 1, filters];
        else
          return [subscriptions, filters]
      }, [0, 0]);

      statusStr = statusStr.replace(/\?1\?/, activeSubscriptions).replace(/\?2\?/, activeFilters);
    }
    statusDescr.setAttribute("value", statusStr);

    let activeFilters = [];
    E("abc-tooltip-blocked-label").hidden = (state != "active");
    E("abc-tooltip-blocked").hidden = (state != "active");
    if (state == "active")
    {
      let {getBrowser} = require("./appSupport");
      let stats = RequestNotifier.getWindowStatistics(getBrowser(window).contentWindow);

      let blockedStr = Utils.getString("blocked_count_tooltip");
      blockedStr = blockedStr.replace(/\?1\?/, stats ? stats.blocked : 0).replace(/\?2\?/, stats ? stats.items : 0);

      if (stats && stats.whitelisted + stats.hidden)
      {
        blockedStr += " " + Utils.getString("blocked_count_addendum");
        blockedStr = blockedStr.replace(/\?1\?/, stats.whitelisted).replace(/\?2\?/, stats.hidden);
      }

      E("abc-tooltip-blocked").setAttribute("value", blockedStr);

      if (stats)
      {
        let filterSort = function(a, b)
        {
          return stats.filters[b] - stats.filters[a];
        };
        for (let filter in stats.filters)
          activeFilters.push(filter);
        activeFilters = activeFilters.sort(filterSort);
      }

      if (activeFilters.length > 0)
      {
        let filtersContainer = E("abc-tooltip-filters");
        while (filtersContainer.firstChild)
          filtersContainer.removeChild(filtersContainer.firstChild);

        for (let i = 0; i < activeFilters.length && i < 3; i++)
        {
          let descr = filtersContainer.ownerDocument.createElement("description");
          descr.setAttribute("value", activeFilters[i] + " (" + stats.filters[activeFilters[i]] + ")");
          filtersContainer.appendChild(descr);
        }
      }
    }

    E("abc-tooltip-filters-label").hidden = (activeFilters.length == 0);
    E("abc-tooltip-filters").hidden = (activeFilters.length == 0);
    E("abc-tooltip-more-filters").hidden = (activeFilters.length <= 3);
  },

  /**
   * Updates state of the icon context menu.
   */
  fillIconMenu: function(/**Event*/ event, /**Window*/ window, /**String*/ prefix)
  {
    function hideElement(id, hide)
    {
      let element = window.document.getElementById(id);
      if (element)
        element.hidden = hide;
    }
    function setChecked(id, checked)
    {
      let element = window.document.getElementById(id);
      if (element)
        element.setAttribute("checked", checked);
    }
    function setDisabled(id, disabled)
    {
      let element = window.document.getElementById(id);
      if (element)
        element.setAttribute("disabled", disabled);
    }
    function setDefault(id, isDefault)
    {
      let element = window.document.getElementById(id);
      if (element)
        element.setAttribute("default", isDefault);
    }
    function generateLabel(id, param)
    {
      let element = window.document.getElementById(id);
      if (element)
        element.setAttribute("label", element.getAttribute("labeltempl").replace(/\?1\?/, param));
    }

    let bottombarOpen = this.isBottombarOpen(window);
    hideElement(prefix + "openbottombar", bottombarOpen);
    hideElement(prefix + "closebottombar", !bottombarOpen);

    hideElement(prefix + "whitelistsite", true);
    hideElement(prefix + "whitelistpage", true);

    let location = this.getCurrentLocation(window);
    if (location && require("./contentPolicy").Policy.isBlockableScheme(location))
    {
      let host = null;
      try
      {
        host = location.host.replace(/^www\./, "");
      } catch (e) {}

      if (host)
      {
        let ending = "|";
        location = location.clone();
        if (location instanceof Ci.nsIURL)
          location.ref = "";
        if (location instanceof Ci.nsIURL && location.query)
        {
          location.query = "";
          ending = "?";
        }

        siteWhitelist = Filter.fromText("@@||" + host + "^$document");
        setChecked(prefix + "whitelistsite", siteWhitelist.subscriptions.length && !siteWhitelist.disabled);
        generateLabel(prefix + "whitelistsite", host);
        hideElement(prefix + "whitelistsite", false);

        pageWhitelist = Filter.fromText("@@|" + location.spec + ending + "$document");
        setChecked(prefix + "whitelistpage", pageWhitelist.subscriptions.length && !pageWhitelist.disabled);
        hideElement(prefix + "whitelistpage", false);
      }
      else
      {
        siteWhitelist = Filter.fromText("@@|" + location.spec + "|");
        setChecked(prefix + "whitelistsite", siteWhitelist.subscriptions.length && !siteWhitelist.disabled);
        generateLabel(prefix + "whitelistsite", location.spec.replace(/^mailto:/, ""));
        hideElement(prefix + "whitelistsite", false);
      }
    }

    setDisabled("abc-command-sendReport", !location || !require("./contentPolicy").Policy.isBlockableScheme(location) || location.scheme == "mailto");

    setChecked(prefix + "disabled", !Prefs.enabled);
    setChecked(prefix + "frameobjects", Prefs.frameobjects);
    setChecked(prefix + "slowcollapse", !Prefs.fastcollapse);
    setChecked(prefix + "savestats", Prefs.savestats);

    let {defaultToolbarPosition, statusbarPosition} = require("./appSupport");
    let hasToolbar = defaultToolbarPosition;
    let hasStatusBar = statusbarPosition;
    hideElement(prefix + "showintoolbar", !hasToolbar || prefix == "abc-toolbar-");
    hideElement(prefix + "showinstatusbar", !hasStatusBar);
    hideElement(prefix + "iconSettingsSeparator", (prefix == "abc-toolbar-" || !hasToolbar) && !hasStatusBar);

    setChecked(prefix + "showintoolbar", this.isToolbarIconVisible());
    setChecked(prefix + "showinstatusbar", Prefs.showinstatusbar);

    let {Sync} = require("./sync");
    let syncEngine = Sync.getEngine();
    hideElement(prefix + "sync", !syncEngine);
    setChecked(prefix + "sync", syncEngine && syncEngine.enabled);

    let defAction = (!window.document.popupNode || window.document.popupNode.id == "abc-toolbarbutton" ?
                     Prefs.defaulttoolbaraction :
                     Prefs.defaultstatusbaraction);
    setDefault(prefix + "openbottombar", defAction == 1);
    setDefault(prefix + "closebottombar", defAction == 1);
    setDefault(prefix + "filters", defAction == 2);
    setDefault(prefix + "disabled", defAction == 3);

    let popup = window.document.getElementById(prefix + "popup");
    let items = (popup ? popup.querySelectorAll('menuitem[key]') : []);
    for (let i = 0; i < items.length; i++)
    {
      let item = items[i];
      let match = /^abc-key-/.exec(item.getAttribute("key"));
      if (!match)
        continue;

      let name = match.input.substr(match.index + match[0].length);
      if (!this.hotkeys)
        this.configureKeys(window);
      if (name in this.hotkeys)
      {
        let text = KeySelector.getTextForKey(this.hotkeys[name]);
        if (text)
          item.setAttribute("acceltext", text);
        else
          item.removeAttribute("acceltext");
      }
    }

    hideElement(prefix + "contributebutton", Prefs.hideContributeButton);
  },

  /**
   * Adds Adblock Cash menu items to the content area context menu when it shows
   * up.
   */
  fillContentContextMenu: function(/**Element*/ popup)
  {
    let target = popup.triggerNode;
    if (target instanceof Ci.nsIDOMHTMLMapElement || target instanceof Ci.nsIDOMHTMLAreaElement)
    {
      // HTML image maps will usually receive events when the mouse pointer is
      // over a different element, get the real event target.
      let rect = target.getClientRects()[0];
      target = target.ownerDocument.elementFromPoint(Math.max(rect.left, 0), Math.max(rect.top, 0));
    }

    if (!target)
      return;

    let window = popup.ownerDocument.defaultView;
    let menuItems = [];
    let addMenuItem = function([node, nodeData])
    {
      let type = nodeData.typeDescr.toLowerCase();
      if (type == "background")
      {
        type = "image";
        node = null;
      }

      let label = this.overlay.attributes[type + "contextlabel"];
      if (!label)
        return;

      let item = popup.ownerDocument.createElement("menuitem");
      item.setAttribute("label", label);
      item.setAttribute("class", "abc-contextmenuitem");
      item.addEventListener("command", this.blockItem.bind(this, window, node, nodeData), false);
      popup.appendChild(item);

      menuItems.push(item);
    }.bind(this);

    // Look up data that we have for the node
    let data = RequestNotifier.getDataForNode(target);
    let hadImage = false;
    if (data && !data[1].filter)
    {
      addMenuItem(data);
      hadImage = (data[1].typeDescr == "IMAGE");
    }

    // Look for frame data
    let wnd = Utils.getWindow(target);
    if (wnd.frameElement)
    {
      let data = RequestNotifier.getDataForNode(wnd.frameElement, true);
      if (data && !data[1].filter)
        addMenuItem(data);
    }

    // Look for a background image
    if (!hadImage)
    {
      let extractImageURL = function(computedStyle, property)
      {
        let value = computedStyle.getPropertyCSSValue(property);
        // CSSValueList
        if ("length" in value && value.length >= 1)
          value = value[0];
        // CSSValuePrimitiveType
        if ("primitiveType" in value && value.primitiveType == value.CSS_URI)
          return Utils.unwrapURL(value.getStringValue()).spec;

        return null;
      };

      let node = target;
      while (node)
      {
        if (node.nodeType == Ci.nsIDOMNode.ELEMENT_NODE)
        {
          let style = wnd.getComputedStyle(node, "");
          let bgImage = extractImageURL(style, "background-image") || extractImageURL(style, "list-style-image");
          if (bgImage)
          {
            let data = RequestNotifier.getDataForNode(wnd.document, true, require("./contentPolicy").Policy.type.IMAGE, bgImage);
            if (data && !data[1].filter)
            {
              addMenuItem(data);
              break;
            }
          }
        }

        node = node.parentNode;
      }
    }

    // Add "Remove exception" menu item if necessary
    let location = this.getCurrentLocation(window);
    let filter = (location ? require("./contentPolicy").Policy.isWhitelisted(location.spec) : null);
    if (filter && filter.subscriptions.length && !filter.disabled)
    {
      let label = this.overlay.attributes.whitelistcontextlabel;
      if (!label)
        return;

      let item = popup.ownerDocument.createElement("menuitem");
      item.setAttribute("label", label);
      item.setAttribute("class", "abc-contextmenuitem");
      item.addEventListener("command", this.toggleFilter.bind(this, filter), false);
      popup.appendChild(item);

      menuItems.push(item);
    }

    // Make sure to clean up everything once the context menu is closed
    if (menuItems.length)
    {
      let cleanUp = function(event)
      {
        if (event.eventPhase != event.AT_TARGET)
          return;

        popup.removeEventListener("popuphidden", cleanUp, false);
        for (let i = 0; i < menuItems.length; i++)
          if (menuItems[i].parentNode)
            menuItems[i].parentNode.removeChild(menuItems[i]);
      }.bind(this);
      popup.addEventListener("popuphidden", cleanUp, false);
    }
  },

  /**
   * Called when the user presses a key in the application window, reacts to our
   * shortcut keys.
   */
  onKeyPress: function(/**Event*/ event)
  {
    if (!this.hotkeys)
      this.configureKeys(event.currentTarget);

    for (let key in this.hotkeys)
    {
      if (KeySelector.matchesKey(event, this.hotkeys[key]))
      {
        event.preventDefault();
        let command = event.currentTarget.document.getElementById("abc-command-" + key);
        if (command)
          command.doCommand();
      }
    }
  },

  /**
   * Checks whether the toolbar icon is currently displayed.
   */
  isToolbarIconVisible: function() /**Boolean*/
  {
    if (!CustomizableUI)
      return false;
    let placement = CustomizableUI.getPlacementOfWidget("abc-toolbarbutton");
    return !!placement;
  },

  /**
   * Stores the selected hotkeys, initialized when the user presses a key.
   */
  hotkeys: null,

  /**
   * Chooses shortcut keys that are available in the window according to
   * preferences.
   */
  configureKeys: function(/**Window*/ window)
  {
    let selector = new KeySelector(window);

    this.hotkeys = {};
    for (let name in Prefs)
    {
      let match = /_key$/.exec(name);
      if (match && typeof Prefs[name] == "string")
      {
        let keyName = match.input.substr(0, match.index);
        this.hotkeys[keyName] = selector.selectKey(Prefs[name]);
      }
    }
  },

  /**
   * Toggles open/closed state of the blockable items list.
   */
  toggleBottombar: function(/**Window*/ window)
  {
    if (detachedBottombar && !detachedBottombar.closed)
    {
      detachedBottombar.close();
      detachedBottombar = null;
    }
    else
    {
      let {addBottomBar, removeBottomBar, getBrowser} = require("./appSupport");
      let mustDetach = !addBottomBar || !removeBottomBar || !("abc-bottombar-container" in this.overlay);
      let detach = mustDetach || Prefs.detachsidebar;
      if (!detach && window.document.getElementById("abc-bottombar"))
      {
        removeBottomBar(window);

        let browser = (getBrowser ? getBrowser(window) : null);
        if (browser)
          browser.contentWindow.focus();
      }
      else if (!detach)
      {
        addBottomBar(window, this.overlay["abc-bottombar-container"]);
        let element = window.document.getElementById("abc-bottombar");
        if (element)
        {
          element.setAttribute("width", Prefs.blockableItemsSize.width);
          element.setAttribute("height", Prefs.blockableItemsSize.height);

          let splitter = window.document.getElementById("abc-bottombar-splitter");
          if (splitter)
          {
            splitter.addEventListener("command", function()
            {
              Prefs.blockableItemsSize = {width: element.width, height: element.height};
            }, false);
          }
        }
      }
      else
        detachedBottombar = window.openDialog("chrome://adblockcash/content/ui/sidebarDetached.xul", "_blank", "chrome,resizable,dependent,dialog=no", mustDetach);
    }
  },

  /**
   * Hide contribute button and persist this choice.
   */
  hideContributeButton: function(/**Window*/ window)
  {
    Prefs.hideContributeButton = true;

    for (let id of ["abc-status-contributebutton", "abc-toolbar-contributebutton", "abc-menuitem-contributebutton"])
    {
      let button = window.document.getElementById(id);
      if (button)
        button.hidden = true;
    }
  },

  showNextNotification: function(url)
  {
    let window = this.currentWindow;
    if (!window)
      return;

    let button = window.document.getElementById("abc-toolbarbutton")
      || window.document.getElementById("abc-status");
    if (!button)
      return;

    let notification = Notification.getNextToShow(url);
    if (!notification)
      return;

    this._showNotification(window, button, notification);
  },

  _showNotification: function(window, button, notification)
  {
    let panel = window.document.getElementById("abc-notification");
    if (panel.state !== "closed")
      return;

    function insertMessage(element, text, links)
    {
      let match = /^(.*?)<(a|strong)>(.*?)<\/\2>(.*)$/.exec(text);
      if (!match)
      {
        element.appendChild(window.document.createTextNode(text));
        return;
      }

      let [_, before, tagName, value, after] = match;

      insertMessage(element, before, links);

      let newElement = window.document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
      if (tagName === "a" && links && links.length)
        newElement.setAttribute("href", links.shift());
      insertMessage(newElement, value, links);
      element.appendChild(newElement);

      insertMessage(element, after, links);
    }

    let texts = Notification.getLocalizedTexts(notification);
    let titleElement = window.document.getElementById("abc-notification-title");
    titleElement.textContent = texts.title;
    let messageElement = window.document.getElementById("abc-notification-message");
    messageElement.innerHTML = "";
    let docLinks = [];
    if (notification.links)
      for (let link of notification.links)
        docLinks.push(Utils.getDocLink(link));

    insertMessage(messageElement, texts.message, docLinks);

    messageElement.addEventListener("click", function(event)
    {
      let link = event.target;
      while (link && link !== messageElement && link.localName !== "a")
        link = link.parentNode;
      if (!link || link.localName !== "a")
        return;
      event.preventDefault();
      event.stopPropagation();
      this.loadInBrowser(link.href, window);
    }.bind(this));

    if (notification.type === "question")
    {
      function buttonHandler(approved, event)
      {
        event.preventDefault();
        event.stopPropagation();
        panel.hidePopup();
        Notification.triggerQuestionListeners(notification.id, approved)
        Notification.markAsShown(notification.id);
      }
      window.document.getElementById("abc-notification-yes").onclick = buttonHandler.bind(null, true);
      window.document.getElementById("abc-notification-no").onclick = buttonHandler.bind(null, false);
    }

    panel.setAttribute("class", "abc-" + notification.type);
    panel.setAttribute("noautohide", notification.type === "question");
    panel.openPopup(button, "bottomcenter topcenter", 0, 0, false, false, null);
  }
};
UI.onPopupShowing = UI.onPopupShowing.bind(UI);
UI.onKeyPress = UI.onKeyPress.bind(UI);
UI.onIconClick = UI.onIconClick.bind(UI);
UI.init();

/**
 * List of event handers to be registered for each window. For each event
 * handler the element ID, event and the actual event handler are listed.
 * @type Array
 */
let eventHandlers = [
  ["abc-command-sendReport", "command", UI.openReportDialog.bind(UI)],
  ["abc-command-filters", "command", UI.openFiltersDialog.bind(UI)],
  ["abc-command-sidebar", "command", UI.toggleBottombar.bind(UI)],
  ["abc-command-togglesitewhitelist", "command", function() { UI.toggleFilter(siteWhitelist); }],
  ["abc-command-togglepagewhitelist", "command", function() { UI.toggleFilter(pageWhitelist); }],
  ["abc-command-toggleobjtabs", "command", UI.togglePref.bind(UI, "frameobjects")],
  ["abc-command-togglecollapse", "command", UI.togglePref.bind(UI, "fastcollapse")],
  ["abc-command-togglesavestats", "command", UI.toggleSaveStats.bind(UI)],
  ["abc-command-togglesync", "command", UI.toggleSync.bind(UI)],
  ["abc-command-toggleshowintoolbar", "command", UI.toggleToolbarIcon.bind(UI)],
  ["abc-command-toggleshowinstatusbar", "command", UI.togglePref.bind(UI, "showinstatusbar")],
  ["abc-command-enable", "command", UI.togglePref.bind(UI, "enabled")],
  ["abc-command-contribute", "command", UI.openContributePage.bind(UI)],
  ["abc-command-contribute-hide", "command", UI.hideContributeButton.bind(UI)]
];

onShutdown.add(function()
{
  for (let window in UI.applicationWindows)
    if (UI.isBottombarOpen(window))
      UI.toggleBottombar(window);
});
