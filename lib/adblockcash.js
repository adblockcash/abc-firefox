let ABC_ORIGIN = "http://localhost:3000";

let VISITOR_EMAIL_CACHE_KEY = "adblockcash.visitorEmail";
let VISITOR_TOKEN_CACHE_KEY = "adblockcash.visitorToken";


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

  __listeners: {},

  addListener: function(eventName, listener) {
    this.__listeners[eventName] = this.__listeners[eventName] || [];
    this.__listeners[eventName].push(listener);
  },

  removeListener: function(eventName, listener) {
    if (!this.__listeners[eventName]) {
      return;
    }

    let index = this.__listeners[eventName].indexOf(listener);
    if (index >= 0)
      this.__listeners[eventName].splice(index, 1);
  },

  triggerListeners: function(eventName) {
    if (!this.__listeners[eventName]) {
      return;
    }

    let params = Array.prototype.slice.call(arguments, 1);

    for (listener of this.__listeners[eventName]) {
      listener.apply(null, params);
    }
  },

  init: function() {
    // Refresh currentVisitor data on start
    if ( (this.visitorEmail = localStorage.getItem(VISITOR_EMAIL_CACHE_KEY))
      && (this.visitorToken = localStorage.getItem(VISITOR_TOKEN_CACHE_KEY)) ) {
      this.refreshCurrentVisitor();
    }
  },

  get visitorEmail() { return this.__visitorEmail; },
  set visitorEmail(visitorEmail) {
    this.__visitorEmail = visitorEmail;
    localStorage.setItem(VISITOR_EMAIL_CACHE_KEY, visitorEmail);
  },

  get visitorToken() { return this.__visitorToken; },
  set visitorToken(visitorToken) {
    this.__visitorToken = visitorToken;
    localStorage.setItem(VISITOR_TOKEN_CACHE_KEY, visitorToken);
  },

  refreshCurrentVisitor: function() {
    request = this.makeApiRequest("GET", ABC_ORIGIN + "/visitor/account", true);
    request.then((response) => {
      this.visitor = response.visitor;
      this.visitorEmail = response.visitor.email;
      this.visitorToken = response.meta.authentication_token;
      this.triggerListeners("visitor.changed", this.visitor);
    });

    // Refresh again in 30s, if the request fails
    request.catch(() => {
      setTimeout(() => { this.refreshCurrentVisitor() }, 30 * 1000);
    });

    return request;
  },

  login: function(email, password) {
    let request = new XMLHttpRequest();
    request.open("POST", ABC_ORIGIN + "/visitor/account", true, email, password);

    let promise = new Promise((resolve, reject) => {
      request.addEventListener("load", (event) => {
        let response = JSON.parse(request.responseText);
        this.visitor = response.visitor;
        this.visitorEmail = response.visitor.email;
        this.visitorToken = response.meta.authentication_token;
        this.triggerListeners("visitor.changed", this.visitor);

        resolve(response);
      });

      request.addEventListener("error", (event) => {
        reject(event);
      });
    });

    request.send(formData);

    return promise;
  },

  loginWithProvider: function(window, providerName, successCallback, failureCallback) {
    providerName = providerName || "facebook";
    successCallback = successCallback || (() => {});
    failureCallback = failureCallback || (() => {});

    chrome.tabs.create({
      url: ABC_ORIGIN + "/visitor/auth/auth/facebook"
    }, (loginTab) => {
      window.console.debug("Opened loginTab:", loginTab);

      onUpdatedTabCallback = (tabId, changeInfo, tab) => {
        if (tabId == loginTab.id) {
          window.console.debug("loginWithProvider tab detected url: ", tab.url);

          if (tab.url.indexOf(ABC_ORIGIN) !== -1 && tab.url.indexOf("/external_window") !== 1) {
            let params = parseQueryParams(tab.url);
            window.console.debug("loginWithProvider tab detected params: ", params);

            try {
              if (params.visitor_email && params.visitor_token) {
                this.visitorEmail = params.visitor_email;
                this.visitorToken = params.visitor_token;
                this.refreshCurrentVisitor();
                this.triggerListeners("visitor.changed", this.visitor);

                successCallback(params);
              } else if (params.error) {
                failureCallback(params);
              } else {
                failureCallback(params);
              }
            } catch(e) {
              window.console.error(e, e.stack);
            }

            chrome.tabs.remove(tab.id);
            chrome.tabs.onUpdated.removeListener(onUpdatedTabCallback);
          }
        }
      }

      chrome.tabs.onUpdated.addListener(onUpdatedTabCallback);
    });
  },

  logout: function() {
    this.visitor = null;
    this.visitorEmail = null;
    this.visitorToken = null;
    this.triggerListeners("visitor.changed", this.visitor);
  },

  makeApiRequest: function(type, url, data) {
    let request = new XMLHttpRequest();
    request.open(type, url, true);

    let formData = new FormData();
    if (this.visitorEmail && this.visitorToken) {
      formData.append("visitor_email", this.visitorEmail);
      formData.append("visitor_token", this.visitorToken);
    }
    for (let key in data) {
      formData.append(key, data[key]);
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

    request.send(formData);

    return promise;
  }

};

window.addEventListener("load", function(){
  AdblockCash.init();
}, false);
