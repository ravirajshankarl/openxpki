import Route from '@ember/routing/route';
import { tracked } from '@glimmer/tracking';
import { later, scheduleOnce, cancel } from '@ember/runloop';
import { getOwner } from '@ember/application';
import { Promise } from 'rsvp';

export default class OpenXpkiRoute extends Route {
    // Reserved Ember property "queryParams"
    // https://api.emberjs.com/ember/3.17/classes/Route/properties/queryParams?anchor=queryParams
    queryParams = {
        // refreshModel==true causes an "in-place" transition, so the model
        // hooks for this route (and any child routes) will re-fire
        startat:  { refreshModel: true },
        limit:    { refreshModel: true },
        force:    { refreshModel: true },
    };
    needReboot = ["login", "logout", "login!logout", "welcome"];

    @tracked
    source = {
        page: null,
        ping: null,
        refresh: null,
        structure: null,
        rtoken: null,
        status: null,
        modal: null,
        tabs: [],
        navEntries: [],
        error: null
    };

    // Reserved Ember function "beforeModel"
    beforeModel(transition) {
        var model_id;
        // "force" is only evaluated above using "refreshModel: true"
        if (transition.to.queryParams.force) {
            delete transition.to.queryParams.force;
        }
        model_id = transition.to.params.model_id;
        if (!this.source.navEntries.length || this.needReboot.indexOf(model_id) >= 0) {
            return this.sendAjax({
                data: {
                    page: "bootstrap!structure",
                    baseurl: window.location.pathname
                }
            });
        }
    }

    // Reserved Ember function "model"
    model(params, transition) {
        let data = {
            page: params.model_id
        };
        if (params.limit) { data.limit = params.limit }
        if (params.startat) { data.startat = params.startat }

        let entries = this.source.navEntries.reduce(function(p, n) {
            return p.concat(n, n.entries || []);
        }, []);
        if (entries.findBy("key", params.model_id)) {
            data.target = "top";
        } else if (this.needReboot.indexOf(params.model_id) >= 0) {
            data.target = "top";
        }
        this.source.page = params.model_id;

        return this.sendAjax({ data: data }).then(() => this.source);
    }

    doPing(cfg) {
        return this.source.ping = later(this, () => {
            $.ajax({ url: cfg.href });
            return this.doPing(cfg);
        }, cfg.timeout);
    }

    sendAjax(req) {
        req.dataType = "json";
        var ref;
        if (req.type == null) {
            req.type = (req != null ? (ref = req.data) != null ? ref.action : void 0 : void 0) ? "POST" : "GET";
        }
        if (req.url == null) {
            req.url = getOwner(this).lookup("controller:config").url;
        }
        req.data._ = new Date().getTime();
        $(".loading").addClass("in-progress");
        if (req.type === "POST") {
            req.data._rtoken = this.source.rtoken;
        }
        let target = req.data.target || "self";
        if (target === "self") {
            if (this.source.modal) { target = "modal" }
            else if (this.source.tabs.length > 1) { target = "active" }
            else { target = "top" }
        }
        if (this.source.refresh) {
            cancel(this.source.refresh);
            this.source.refresh = null;
            $(".refresh").removeClass("in-progress");
        }
        return new Promise((resolve, reject) => {
            return $.ajax(req).then(doc => {
                // work with a copy of this.source
                let newSource = Object.assign({
                    status: doc.status,
                    modal: null
                }, this.source);

                if (doc.ping) {
                    if (this.source.ping) { cancel(this.source.ping) }
                    this.doPing(doc.ping);
                }
                if (doc.refresh) {
                    newSource.refresh = later(this, function() {
                        return this.sendAjax({ data: { page: doc.refresh.href } });
                    }, doc.refresh.timeout);
                    scheduleOnce("afterRender", function() {
                        return $(".refresh").addClass("in-progress");
                    });
                }
                if (doc.goto) {
                    if (doc.target === '_blank' || /^(http|\/)/.test(doc.goto)) {
                        window.location.href = doc.goto;
                    }
                    else {
                        this.transitionTo("openxpki", doc.goto);
                    }
                }
                else if (doc.structure) {
                    newSource.navEntries = doc.structure;
                    newSource.user = doc.user;
                    newSource.rtoken = doc.rtoken;
                }
                else {
                    if (doc.page && doc.main) {
                        newSource.tabs = [...this.source.tabs]; // copy tabs to not trigger change observers for now
                        let newTab = {
                            active: true,
                            page: doc.page,
                            main: doc.main,
                            right: doc.right
                        };
                        if (target === "modal") {
                            newSource.modal = newTab;
                        }
                        else if (target === "tab") {
                            let tabs = newSource.tabs;
                            tabs.setEach("active", false);
                            tabs.pushObject(newTab);
                        }
                        else if (target === "active") {
                            let tabs = newSource.tabs;
                            let index = tabs.indexOf(tabs.findBy("active"));
                            tabs.replace(index, 1, [newTab]); // top
                        }
                        else {
                            newSource.tabs = [newTab];
                        }
                    }
                    scheduleOnce("afterRender", function() {
                        return $(".loading").removeClass("in-progress");
                    });
                }
                this.source = newSource; // trigger observers
                return resolve(doc);
            }, (err) => {
                $(".loading").removeClass("in-progress");
                this.source.error = {
                    message: "The server did not return JSON data as expected.\nMaybe your authentication session has expired."
                };
                return resolve({});
            });
        });
    }
}