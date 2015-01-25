let Utils = require("utils").Utils;
let GLOBALS = require("env").GLOBALS;

// Extract query params from an url to a object.
//
// F.e. transform "https://yt.com/watch?v=k7x51zWOBBs&index=112#t=12m"
// to {v: "k7x51zWOBBs", index: "112"} .
function parseQueryParams(url) {
  let queryString = url.substr(url.indexOf('?') + 1);
  if (queryString.indexOf("#") !== -1) {
    queryString = queryString.substr(0, queryString.indexOf("#"));
  }
  let qs = decodeURIComponent(queryString);
  let obj = {};
  let params = qs.split('&');
  params.forEach(function (param) {
    let splitter = param.split('=');
    obj[splitter[0]] = splitter[1];
  });
  return obj;
}


// Add .setObject and .getObject methods to Storage prototype
// (used by localStorage and sessionStorage).
Storage.prototype.setObject = function(key, value) {
  return this.setItem(key, JSON.stringify(value));
};

Storage.prototype.getObject = function(key) {
  let value = this.getItem(key);
  if (value && value != "undefined") {
    try {
      return JSON.parse(value);
    } catch(e) {}
  }
};

let AdblockCash = exports.AdblockCash = {
  VISITOR_NOTIFICATION_TYPES: ["new_features", "special_rewards", "new_whitelisted_websites"],

  _VISITOR_CACHE_KEY: "adblockcash.visitor",
  _WHITELISTABLE_WEBSITES_CACHE_KEY: "adblockcash.cashableWebsites",

  _listeners: {},

  // If true (when an other adblock extension has been detected as running),
  // then we'll disable whitelisting features, like collecting the cashcoins.
  isOtherAdblockEnabled: false,

  // Map of websites' domains that are cashable
  cashableWebsitesByDomain: {
    "example.com": {}
  },

  addListener: function(eventName, listener) {
    this._listeners[eventName] = this._listeners[eventName] || [];
    this._listeners[eventName].push(listener);
  },

  removeListener: function(eventName, listener) {
    if (!this._listeners[eventName]) {
      return;
    }

    let index = this._listeners[eventName].indexOf(listener);
    if (index >= 0)
      this._listeners[eventName].splice(index, 1);
  },

  triggerListeners: function(eventName) {
    if (!this._listeners[eventName]) {
      return;
    }

    let params = Array.prototype.slice.call(arguments, 1);

    for (let listener of this._listeners[eventName]) {
      listener.apply(null, params);
    }
  },

  init: function() {
    // Get visitor's data from localStorage and refresh it on the start
    this.visitor = localStorage.getObject(this._VISITOR_CACHE_KEY);
    // if (this.visitor) {
    //   this.refreshCurrentVisitor();
    // }

    this.cashableWebsites = localStorage.getObject(this._WHITELISTABLE_WEBSITES_CACHE_KEY);

    // We call it immediatily in case "visitor.updated" wouldn't be called at all
    // (if we aren't signed in)
    if (!this.visitor) {
      setTimeout(this.refreshCashableWebsites.bind(this));
    }
    this.addListener("visitor.updated", () => { this.refreshCashableWebsites(); });
  },

  get visitor() { return this.__visitor; },
  set visitor(visitor) {
    this.__visitor = visitor;
    this.triggerListeners("visitor.updated", this.visitor);

    if (visitor) {
      localStorage.setObject(this._VISITOR_CACHE_KEY, visitor);
    } else {
      localStorage.removeItem(this._VISITOR_CACHE_KEY);
    }
  },

  get cashableWebsites() { return this.__cashable_websites || []; },
  set cashableWebsites(cashableWebsites) {
    delete this.__cashableCountriesList;
    this.__cashable_websites = cashableWebsites || [];

    this.cashableWebsitesByDomain = {};
    this.__cashable_websites.forEach((website) => {
      this.cashableWebsitesByDomain[website.domain] = website;
    });

    this.triggerListeners("cashableWebsites.updated", this.visitor);

    if (cashableWebsites) {
      localStorage.setObject(this._WHITELISTABLE_WEBSITES_CACHE_KEY, cashableWebsites);
    } else {
      localStorage.removeItem(this._WHITELISTABLE_WEBSITES_CACHE_KEY);
    }
  },

  setupErrorReporting: function(window, document) {
    if (GLOBALS.ENV == "development") {
      return false;
    }

    var _rollbarConfig = window._rollbarConfig = {
      rollbarJsUrl: "/assets/rollbar.js",
      accessToken: "cbd7cce4dc3e409eada424e7fb88d16d",
      captureUncaught: true,
      payload: {
        environment: GLOBALS.ENV
      }
    };

    !function(a,b){function c(b){this.shimId=++h,this.notifier=null,this.parentShim=b,this.logger=function(){},a.console&&void 0===a.console.shimId&&(this.logger=a.console.log)}function d(b,c,d){a._rollbarWrappedError&&(d[4]||(d[4]=a._rollbarWrappedError),d[5]||(d[5]=a._rollbarWrappedError._rollbarContext),a._rollbarWrappedError=null),b.uncaughtError.apply(b,d),c&&c.apply(a,d)}function e(b){var d=c;return g(function(){if(this.notifier)return this.notifier[b].apply(this.notifier,arguments);var c=this,e="scope"===b;e&&(c=new d(this));var f=Array.prototype.slice.call(arguments,0),g={shim:c,method:b,args:f,ts:new Date};return a._rollbarShimQueue.push(g),e?c:void 0})}function f(a,b){if(b.hasOwnProperty&&b.hasOwnProperty("addEventListener")){var c=b.addEventListener;b.addEventListener=function(b,d,e){c.call(this,b,a.wrap(d),e)};var d=b.removeEventListener;b.removeEventListener=function(a,b,c){d.call(this,a,b&&b._wrapped?b._wrapped:b,c)}}}function g(a,b){return b=b||this.logger,function(){try{return a.apply(this,arguments)}catch(c){b("Rollbar internal error:",c)}}}var h=0;c.init=function(a,b){var e=b.globalAlias||"Rollbar";if("object"==typeof a[e])return a[e];a._rollbarShimQueue=[],a._rollbarWrappedError=null,b=b||{};var h=new c;return g(function(){if(h.configure(b),b.captureUncaught){var c=a.onerror;a.onerror=function(){var a=Array.prototype.slice.call(arguments,0);d(h,c,a)};var g,i,j="EventTarget,Window,Node,ApplicationCache,AudioTrackList,ChannelMergerNode,CryptoOperation,EventSource,FileReader,HTMLUnknownElement,IDBDatabase,IDBRequest,IDBTransaction,KeyOperation,MediaController,MessagePort,ModalWindow,Notification,SVGElementInstance,Screen,TextTrack,TextTrackCue,TextTrackList,WebSocket,WebSocketWorker,Worker,XMLHttpRequest,XMLHttpRequestEventTarget,XMLHttpRequestUpload".split(",");for(g=0;g<j.length;++g)i=j[g],a[i]&&a[i].prototype&&f(h,a[i].prototype)}return a[e]=h,h},h.logger)()},c.prototype.loadFull=function(a,b,c,d,e){var f=g(function(){var a=b.createElement("script"),e=b.getElementsByTagName("script")[0];a.src=d.rollbarJsUrl,a.async=!c,a.onload=h,e.parentNode.insertBefore(a,e)},this.logger),h=g(function(){var b;if(void 0===a._rollbarPayloadQueue){var c,d,f,g;for(b=new Error("rollbar.js did not load");c=a._rollbarShimQueue.shift();)for(f=c.args,g=0;g<f.length;++g)if(d=f[g],"function"==typeof d){d(b);break}}"function"==typeof e&&e(b)},this.logger);g(function(){c?f():a.addEventListener?a.addEventListener("load",f,!1):a.attachEvent("onload",f)},this.logger)()},c.prototype.wrap=function(b,c){try{var d;if(d="function"==typeof c?c:function(){return c||{}},"function"!=typeof b)return b;if(b._isWrap)return b;if(!b._wrapped){b._wrapped=function(){try{return b.apply(this,arguments)}catch(c){throw c._rollbarContext=d(),c._rollbarContext._wrappedSource=b.toString(),a._rollbarWrappedError=c,c}},b._wrapped._isWrap=!0;for(var e in b)b.hasOwnProperty(e)&&(b._wrapped[e]=b[e])}return b._wrapped}catch(f){return b}};for(var i="log,debug,info,warn,warning,error,critical,global,configure,scope,uncaughtError".split(","),j=0;j<i.length;++j)c.prototype[i[j]]=e(i[j]);var k="//d37gvrvc0wt4s1.cloudfront.net/js/v1.1/rollbar.min.js";_rollbarConfig.rollbarJsUrl=_rollbarConfig.rollbarJsUrl||k;var l=c.init(a,_rollbarConfig);l.loadFull(a,b,!1,_rollbarConfig)}(window,document);
  },

  getCountriesList: function() {
    return new Promise((resolve, reject) => {
      if (this.__countriesList) {
        resolve(this.__countriesList);
      }

      requestPromise = this._makeApiRequest("GET", GLOBALS.ABC_BACKEND_ORIGIN + "/utils/countries.json");
      requestPromise.then((response) => {
        resolve(this.__countriesList = response);
      });

      // Refresh again in 30s, if the request fails
      requestPromise.catch(() => {
        setTimeout(() => { this.getCountriesList(); }, 30 * 1000);
      });
    });
  },

  getPaymentDetails: function(countryCode) {
    return this._makeApiRequest("GET", GLOBALS.ABC_BACKEND_ORIGIN + "/utils/payment_details/"+ countryCode + ".json");
  },

  getCashableCountriesList: function() {
    return this.getCountriesList().then((countries) => {
      if (this.__cashableCountriesList) {
        resolve(this.__cashableCountriesList);
      }

      var countryCodesWithCashableWebsites = {};
      this.cashableWebsites.forEach(function(website) {
        if (website.country_code) {
          countryCodesWithCashableWebsites[website.country_code] = true;
        }
      });

      return this.__cashableCountriesList = countries.filter((country) => {
        return countryCodesWithCashableWebsites[country.code];
      })
    });
  },

  // Refresh current visitor's data
  refreshCurrentVisitor: function() {
    requestPromise = this._makeApiRequest("GET", GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/account.json");
    requestPromise.then((response) => {
      this.visitor = response.visitor;
    });

    // Refresh again in 30s, if the request fails
    requestPromise.catch((error) => {
      if (error && error.status == 401) {
        this.visitor = null;
      } else {
        setTimeout(() => { this.refreshCurrentVisitor(); }, 30 * 1000);
      }
    });

    return requestPromise;
  },

  // Login with ABC
  login: function(email, password) {
    let request = new XMLHttpRequest();
    request.open("POST", GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/account.json", true, email, password);

    let promise = new Promise((resolve, reject) => {
      request.addEventListener("load", (event) => {
        let response = JSON.parse(request.responseText);
        this.visitor = response.visitor;

        resolve(response);
      });

      request.addEventListener("error", (event) => {
        reject(event);
      });
    });

    request.send(formData);

    return promise;
  },

  // Login with facebook/google
  loginWithProvider: function(window, providerName) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create({
        url: GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/auth/auth/" + providerName
      }, (loginTab) => {
        window.console.debug("Opened loginTab:", loginTab);

        onUpdatedTabCallback = (tabId, changeInfo, tab) => {
          if (tabId == loginTab.id) {
            window.console.debug("loginWithProvider tab detected url: ", tab.url);

            if ((tab.url.indexOf(GLOBALS.ABC_BACKEND_ORIGIN) === 0) && (tab.url.indexOf("/external_window") > 0)) {
              let params = parseQueryParams(tab.url);
              window.console.debug("loginWithProvider tab detected params: ", params);

              try {
                if (params.visitor_email && params.visitor_token) {
                  this.visitor = {
                    email: params.visitor_email,
                    authentication_token: params.visitor_token
                  };
                  this.refreshCurrentVisitor();

                  resolve(params);
                } else if (params.error) {
                  reject(params.error);
                } else {
                  reject(JSON.stringify(params));
                }
              } catch(e) {
                window.console.error(e, e.stack);
              }

              chrome.tabs.remove(tab.id);
              chrome.tabs.onUpdated.removeListener(onUpdatedTabCallback);
            }
          }
        };

        chrome.tabs.onUpdated.addListener(onUpdatedTabCallback);
      });
    });
  },

  // Logout the visitor
  logout: function() {
    this.visitor = null;
  },

  // Update visitor's notification_settings
  updateNotificationSettings: function(settings) {
    return this._makeApiRequest("POST", GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/notifications/settings.json", {
        notification_settings: settings
      })
      .then((response) => {
        if (response.visitor) {
          this.visitor = response.visitor;
        } else {
          console.error("Error while AdblockCash.updateNotificationSettings(): ", response);
        }
      })
      .catch((error) => {
        console.error("Error while AdblockCash.updateNotificationSettings(): ", error);
      });
  },

  // Update Visitor's data
  updateVisitorAccount: function(visitor) {
    return this._makeApiRequest("PUT", GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/account.json", {
        visitor: visitor
      })
      .then((response) => {
        if (response.visitor) {
          this.visitor = response.visitor;
        } else {
          console.error("Error while AdblockCash.updateVisitorAccount(): ", response);
        }
      })
      .catch((error) => {
        console.error("Error while AdblockCash.updateVisitorAccount(): ", error);
      });
  },

  refreshCashableWebsites: function() {
    let FilterStorage = require("filterStorage").FilterStorage;

    return this._makeApiRequest("GET", GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/websites/cashable.json")
      .then((response) => {
        if (response.websites) {
          this.cashableWebsites = response.websites;

          setTimeout(function(){
            // Automatically whitelist all new cashableWebsites,
            // which we haven't disabled yet
            this.cashableWebsites
              .filter((website) => {
                return !this.isCashableDomainBlocked(website.domain) && !this.isDomainWhitelisted(website.domain);
              })
              .forEach((website) => {
                this.addWhitelistedDomain(website.domain);
              });
          }.bind(this));
        } else {
          console.error("Error while AdblockCash.refreshCashableWebsites(): ", response);
        }
      })
      .catch((error) => {
        console.error("Error while AdblockCash.refreshCashableWebsites(): ", error);
      });
  },

  isDomainWhitelisted: function(domain) {
    return !!require("whitelisting").isWhitelisted("http://" + domain);
  },

  isDomainCashable: function(domain) {
    // Drop the www. from the beginning
    domain = domain.replace(/^(?:www\.)?/, "");

    return this.cashableWebsitesByDomain[domain];
  },

  // Add a whitelist filter for given domain
  // @param {String} domain
  // @param {Boolean} blockCashableDomain if true and if domain is cashable, we'll remove it from disabled cashable domains list
  // @param {Boolean} silent if true, no listeners will be triggered (to be used when filter list is reloaded)
  addWhitelistedDomain: function(domain, blockCashableDomain, silent) {
    let FilterStorage = require("filterStorage").FilterStorage;

    if (blockCashableDomain == null) {
      blockCashableDomain = true;
    }
    if (blockCashableDomain && AdblockCash.isDomainCashable(domain)) {
      AdblockCash.unblockCashableDomain(domain);
    }

    console.debug("AdblockCash.addWhitelistedDomain(" + domain + ")");
    var filterText = "@@||" + domain + "^$document";
    return FilterStorage.addFilter(Filter.fromText(filterText), undefined, undefined, silent);
  },

  // Remove whitelist filters for given domain
  // @param {String} domain
  // @param {Boolean} blockCashableDomain if true and if domain is cashable, we'll add it to disabled cashable domains list
  removeWhitelistedDomain: function(domain, blockCashableDomain, silent) {
    let FilterStorage = require("filterStorage").FilterStorage;

    if (blockCashableDomain == null) {
      blockCashableDomain = true;
    }
    if (blockCashableDomain && AdblockCash.isDomainCashable(domain)) {
      AdblockCash.blockCashableDomain(domain);
    }

    console.debug("AdblockCash.removeWhitelistedDomain(" + domain + ")");
    var filterText = "@@||" + domain + "^$document";
    return FilterStorage.removeFilter(Filter.fromText(filterText), undefined, undefined, silent);
  },

  // When we unwhitelist a cashable domain,
  //   block it - so it won't be automatically added as whitelisted
  //   when we refresh cashableWebsites.
  blockCashableDomain: function(domain) {
    Prefs.blockedCashableDomains.push(domain);
    setTimeout(function(){
      Prefs.blockedCashableDomains = Prefs.blockedCashableDomains;
    });
  },

  // Invert the effect of this.blockCashableDomain()
  unblockCashableDomain: function(domain) {
    var i = Prefs.blockedCashableDomains.indexOf(domain);
    if (i) {
      Prefs.blockedCashableDomains.splice(i, 1);
    }
    setTimeout(function(){
      Prefs.blockedCashableDomains = Prefs.blockedCashableDomains;
    });
  },

  isCashableDomainBlocked: function(domain) {
    return Prefs.blockedCashableDomains.indexOf(domain) >= 0;
  },

  sendVisitDetection: function(domain, whitelisted) {
    this.__sendVisitDetectionRequests = this.__sendVisitDetectionRequests || {};
    this.__sendVisitDetectionRequests[domain] = this.__sendVisitDetectionRequests[domain] || Utils.debounce(debouncedFunction, 3000);

    function debouncedFunction(domain, whitelisted) {
      if (this.isOtherAdblockEnabled) {
        return false;
      }

      return this._makeApiRequest("POST", GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/detector/visit.json", {
          website_domain: domain,
          whitelisted: whitelisted
        })
        .catch((error) => {
          console.error("Error while AdblockCash.sendVisitDetection(): ", error);
        });
    }

    this.__sendVisitDetectionRequests[domain].apply(this, arguments);
  },

  // Checks whether any of other popular adblock extensions is currently installed and enabled.
  // @return {Boolean} true, if there's at least one other adblock currently enabled
  detectOtherAdblockExtensions: function() {
    if (chrome) {
      let adblockExtensionIds = {
        ab: "gighmmpiobklfepjocnamgkkbiglidom",
        abpls: "cfhdojbkjhnklbpkdaibdccddilifddb",
        abpro: "ocifcklkibdehekfnmflempfgjhbedch",
        abprem: "fndlhnanhedoklpdaacidomdnplcjcpj",
        absup: "knebimhcckndhiglamoabbnifdkijidd",
        adgrd: "bgnkhhnnamicmpeenaelnjfhikgbkllg",
        adrem: "mcefmojpghnaceadnghednjhbmphipkb",
        ghst: "mlomiejdfkolichcflejclcbmpeaniij",
        disc: "jeoacafpbcihiomhlakheieifhpjdfeo"
      };

      return new Promise((resolve, reject) => {
        chrome.management.getAll((extensions) => {
          let extensionsById = {};
          extensions.forEach((extension) => { extensionsById[extension.id] = extension; });

          let enabledAdblocks = Object.keys(adblockExtensionIds).filter((key) => {
            let extensionId = adblockExtensionIds[key];
            let extensionInfo = extensionsById[extensionId];

            return !!(extensionInfo && extensionInfo.enabled);
          });

          let isOtherAdblockEnabled = this.isOtherAdblockEnabled = enabledAdblocks.length > 0;

          resolve(isOtherAdblockEnabled);
        });
      });
    }
  },

  _makeApiRequest: function(type, url, data) {
    data = data || {};

    let request = new XMLHttpRequest();
    request.open(type, url, true);
    request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

    if (this.visitor) {
      request.setRequestHeader("X-Visitor-Email", this.visitor.email);
      request.setRequestHeader("X-Visitor-Token", this.visitor.authentication_token);
    }

    console.log(type, url, data);

    let promise = new Promise((resolve, reject) => {
      request.addEventListener("load", (event) => {
        let response = JSON.parse(request.responseText);
        if (request.status >= 200 && request.status < 400) {
          resolve(response);
        } else {
          reject(request);
        }
      });

      request.addEventListener("error", (event) => {
        reject(event);
      });
    });

    try {
      jsonEncodedData = JSON.stringify(data);
    } catch(e) {
      console.error(data);
      throw e;
    }
    request.send(jsonEncodedData);

    return promise;
  }

};

window.addEventListener("load", function(){
  AdblockCash.init();
}, false);
