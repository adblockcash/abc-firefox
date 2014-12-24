let Utils = require("utils").Utils;

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

  ABC_ORIGIN: "http://localhost:3000",

  VISITOR_NOTIFICATION_TYPES: ["new_features", "special_rewards", "new_whitelisted_websites"],

  _VISITOR_CACHE_KEY: "adblockcash.visitor",
  _WHITELISTABLE_WEBSITES_CACHE_KEY: "adblockcash.whitelistableWebsites",

  _listeners: {},

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
    if (this.visitor) {
      this.refreshCurrentVisitor();
    }

    this.whitelistableWebsites = localStorage.getObject(this._WHITELISTABLE_WEBSITES_CACHE_KEY);

    this.addListener("visitor.updated", () => { this.refreshWhitelistableWebsites(); });
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

  get whitelistableWebsites() { return this.__whitelistable_websites || []; },
  set whitelistableWebsites(whitelistableWebsites) {
    this.__whitelistable_websites = whitelistableWebsites;
    this.triggerListeners("whitelistableWebsites.updated", this.visitor);

    if (whitelistableWebsites) {
      localStorage.setObject(this._WHITELISTABLE_WEBSITES_CACHE_KEY, whitelistableWebsites);
    } else {
      localStorage.removeItem(this._WHITELISTABLE_WEBSITES_CACHE_KEY);
    }
  },

  // Refresh current visitor's data
  refreshCurrentVisitor: function() {
    requestPromise = this._makeApiRequest("GET", this.ABC_ORIGIN + "/visitor/account", true);
    requestPromise.then((response) => {
      this.visitor = response.visitor;
    });

    // Refresh again in 30s, if the request fails
    requestPromise.catch(() => {
      setTimeout(() => { this.refreshCurrentVisitor(); }, 30 * 1000);
    });

    return requestPromise;
  },

  // Login with ABC
  login: function(email, password) {
    let request = new XMLHttpRequest();
    request.open("POST", this.ABC_ORIGIN + "/visitor/account", true, email, password);

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
        url: this.ABC_ORIGIN + "/visitor/auth/auth/" + providerName
      }, (loginTab) => {
        window.console.debug("Opened loginTab:", loginTab);

        onUpdatedTabCallback = (tabId, changeInfo, tab) => {
          if (tabId == loginTab.id) {
            window.console.debug("loginWithProvider tab detected url: ", tab.url);

            if ((tab.url.indexOf(this.ABC_ORIGIN) === 0) && (tab.url.indexOf("/external_window") > 0)) {
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
  updateNotificationSettings: function(window, settings) {
    return this._makeApiRequest("POST", this.ABC_ORIGIN + "/visitor/notifications/settings", {
        notification_settings: settings
      })
      .then((response) => {
        if (response.visitor) {
          this.visitor = response.visitor;
        } else {
          window.console.error("Error while AdblockCash.updateNotificationSettings(): ", response);
        }
      })
      .catch((error) => {
        window.console.error("Error while AdblockCash.updateNotificationSettings(): ", error);
      });
  },

  // Update Visitor's data
  updateVisitorAccount: function(window, visitor) {
    return this._makeApiRequest("PUT", this.ABC_ORIGIN + "/visitor/account", {
        visitor: visitor
      })
      .then((response) => {
        if (response.visitor) {
          this.visitor = response.visitor;
        } else {
          window.console.error("Error while AdblockCash.updateVisitorAccount(): ", response);
        }
      })
      .catch((error) => {
        window.console.error("Error while AdblockCash.updateVisitorAccount(): ", error);
      });
  },

  refreshWhitelistableWebsites: function() {
    return this._makeApiRequest("GET", this.ABC_ORIGIN + "/visitor/websites/whitelistable")
      .then((response) => {
        if (response.websites) {
          this.whitelistableWebsites = response.websites;
        } else {
          console.error("Error while AdblockCash.refreshWhitelistableWebsites(): ", response);
        }
      })
      .catch((error) => {
        console.error("Error while AdblockCash.refreshWhitelistableWebsites(): ", error);
      });
  },

  isDomainWhitelistable: function(domain) {
    // Drop the www. from the beginning
    domain = domain.replace(/^(?:www\.)?/, "");

    return this.whitelistableWebsites.filter(function(website){
      return website.domain === domain;
    })[0];
  },

  sendVisitDetection: function(domain, whitelisted) {
    this.__sendVisitDetectionRequests = this.__sendVisitDetectionRequests || {};
    this.__sendVisitDetectionRequests[domain] = this.__sendVisitDetectionRequests[domain] || Utils.debounce(debouncedFunction, 3000);

    function debouncedFunction(domain, whitelisted) {
      return this._makeApiRequest("POST", this.ABC_ORIGIN + "/visitor/detector/visit", {
          website_domain: domain,
          whitelisted: whitelisted
        })
        .catch((error) => {
          console.error("Error while AdblockCash.sendVisitDetection(): ", error);
        });
    }

    this.__sendVisitDetectionRequests[domain].apply(this, arguments);
  },

  _makeApiRequest: function(type, url, data) {
    let request = new XMLHttpRequest();
    request.open(type, url, true);
    request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

    data = data || {};
    if (this.visitor) {
      data["visitor_email"] = this.visitor.email;
      data["visitor_token"] = this.visitor.authentication_token;
    }

    let promise = new Promise((resolve, reject) => {
      request.addEventListener("load", (event) => {
        let response = JSON.parse(request.responseText);
        resolve(response);
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
