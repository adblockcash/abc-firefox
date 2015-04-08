if (typeof chrome == "undefined") {
  var {Cm,Cc,Ci,Cr,Cu,components} = require("chrome");

  // let {setTimeout, clearTimeout}
  Cu.import("resource://gre/modules/Timer.jsm");

  // var XMLHttpRequest = components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest");
  XMLHttpRequest = require("sdk/net/xhr").XMLHttpRequest;
}

let {CommonUtils} = require("./commonUtils");
let {Utils} = require("./utils");
let {GLOBALS} = require("./env");
let {Prefs} = require("./prefs");
let {isWhitelisted} = require("./whitelisting");
let {FilterStorage} = require("./filterStorage");
let {Filter} = require("./filterClasses");
let {Pages} = require("./pages");

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

let AdblockCash = exports.AdblockCash = {
  VISITOR_NOTIFICATION_TYPES: ["new_features", "special_rewards", "new_whitelisted_websites"],

  _VISITOR_CACHE_KEY: "adblockcash_visitor",
  _WHITELISTABLE_WEBSITES_CACHE_KEY: "adblockcash_cashableWebsites",

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
    Prefs["blockedCashableDomains"] = Prefs["blockedCashableDomains"] || [];

    this.visitor = Prefs[this._VISITOR_CACHE_KEY];
    // if (this.visitor) {
    //   this.refreshCurrentVisitor();
    // }

    this.cashableWebsites = Prefs[this._WHITELISTABLE_WEBSITES_CACHE_KEY];

    // We call it immediatily in case "visitor.updated" wouldn't be called at all
    // (if we aren't signed in)
    if (!this.visitor) {
      setTimeout(() => { this.refreshCashableWebsites(); });
    }
    this.addListener("visitor.updated", () => { this.refreshCashableWebsites(); });
  },

  get visitor() { return this.__visitor; },
  set visitor(visitor) {
    this.__visitor = visitor;
    this.triggerListeners("visitor.updated", this.visitor);

    if (visitor) {
      Prefs[this._VISITOR_CACHE_KEY] = visitor;
    } else {
      Prefs[this._VISITOR_CACHE_KEY] = null;
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
      Prefs[this._WHITELISTABLE_WEBSITES_CACHE_KEY] = cashableWebsites;
    } else {
      Prefs[this._WHITELISTABLE_WEBSITES_CACHE_KEY] = null;
    }
  },

  setupErrorReporting: function(window, document) {
    if (!GLOBALS.ROLLBAR_CLIENT_ACCESS_TOKEN) {
      return false;
    }

    var _rollbarConfig = window._rollbarConfig = {
      rollbarJsUrl: "/shared/js/rollbar.js",
      accessToken: GLOBALS.ROLLBAR_CLIENT_ACCESS_TOKEN,
      captureUncaught: true,
      payload: {
        environment: GLOBALS.ENV
      }
    };

    require("./rollbar-shimload").initRollbar(window, document);
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
      let url = GLOBALS.ABC_BACKEND_ORIGIN + "/visitor/auth/auth/" + providerName;

      Pages.openAndListenForUrlChangesUntil(url, (tabUrl) => {
        if ((tabUrl.indexOf(GLOBALS.ABC_BACKEND_ORIGIN) === 0) && (tabUrl.indexOf("/external_window") > 0)) {
          let params = parseQueryParams(tabUrl);
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

          return true;
        }

        return false;
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
  updateVisitorAccount: function(visitor = {}) {
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
    return !!isWhitelisted("http://" + domain);
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
    Prefs["blockedCashableDomains"].push(domain);
    setTimeout(function(){
      Prefs["blockedCashableDomains"] = Prefs["blockedCashableDomains"];
    });
  },

  // Invert the effect of this.blockCashableDomain()
  unblockCashableDomain: function(domain) {
    var i = Prefs["blockedCashableDomains"].indexOf(domain);
    if (i) {
      Prefs["blockedCashableDomains"].splice(i, 1);
    }
    setTimeout(function(){
      Prefs["blockedCashableDomains"] = Prefs["blockedCashableDomains"];
    });
  },

  isCashableDomainBlocked: function(domain) {
    return Prefs["blockedCashableDomains"].indexOf(domain) >= 0;
  },

  sendVisitDetection: function(domain, whitelisted) {
    this.__sendVisitDetectionRequests = this.__sendVisitDetectionRequests || {};
    this.__sendVisitDetectionRequests[domain] = this.__sendVisitDetectionRequests[domain] || CommonUtils.debounce(debouncedFunction, 3000);

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
    if (typeof chrome != "undefined") {
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

setTimeout(function(){
  AdblockCash.init();
});
