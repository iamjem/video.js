vjs.Tracking =  vjs.CoreObject.extend({
  init: function(player, options) {
    this.player_ = player;

    this.options_ = vjs.obj.copy(this.options_);
    options = vjs.Component.prototype.options.call(this, options);

    this.lastTimeupdate_ = null;
    this.activeProfiles_ = [];
    this.globalProfiles_ = [];
    
    // handle global profiles
    var profiles = this.options.profiles;
    if (profiles.length) {
      profiles = this.globalProfiles_ = this.initProfiles(profiles);
      this.addProfiles(profiles, true);
    }

    this.onTimeupdate = vjs.bind(this, this.onTimeupdate);
    this.player_.on('loadstart', vjs.bind(this, this.onLoadstart));
    this.player_.on('dispose', vjs.bind(this, this.onDispose));
  },

  addProfiles: function(profiles, global) {
    for (var i = 0, l = profiles.length; i < l; i++) {
      profiles[i].bind();
    }    
    if (global === undefined) {
      this.activeProfiles_ = this.activeProfiles_.concat(profiles);
    }
    return this;
  },

  removeProfiles: function(global) {
    var profiles;
    if (global === undefined) {
      profiles = this.activeProfiles_;
      for (var i = 0, l = profiles.length; i < l; i++) {
        profiles[i].dispose();
      }
      this.activeProfiles_ = [];
    }
    else {
      profiles = this.globalProfiles_;
      for (var i = 0, l = profiles.length; i < l; i++) {
        profiles[i].cleanup();
      }
      this.globalProfiles_ = [];
    }
    
    return this;
  },

  // take raw profile options, initialize profile class, returns profile objects
  initProfiles: function(profileData) {
    var profiles = [],
        player = this.player_,
        p, pClass;

    for (var i = 0, l = profileData.length; i < l; i++) {
      p = profileData[i];
      if (p.profileName) {
        pClass = vjs.Tracking.getProfile(p.profileName);
        if (pClass !== undefined) {
          profiles.push(new pClass(player, p));
        }
        else {
          vjs.log('Could not find profile with name: ' + p.profileName);
        }
      }
    }
  
    return profiles;
  },

  onLoadstart: function(e) {
    player.off('timeupdate', this.onTimeupdate);
    this.removeProfiles();

    var player = this.player_,
        current = player.config_.getCurrent();

    if (current !== null && current.components) {
      var profiles = player.config_.getCurrentConfig('tracking.profiles');
      if (profiles !== null) {
        profiles = this.initProfiles(profiles);
        this.addProfiles(profiles);
      }
      player.on('timeupdate', this.onTimeupdate);
    }

    return this;
  },
  // throttle special timeupdate events across active profiles
  onTimeupdate: function(e) {
    var curr = Math.round(this.player_.currentTime());
    if (this.lastTimeupdate_ !== curr) {
      this.lastTimeupdate_ = curr;
      var profiles = [].concat(this.activeProfiles_, this.globalProfiles_);
      for (var i = 0, l = profiles.length; i < l; i++) {
        profiles[i].trigger('timeupdate.' + curr, e);
      }
    }
  },

  onDispose: function(){
    this.removeProfiles();
    this.removeProfiles(true);
  }

});

vjs.Tracking.prototype.options_ = {
  profiles: []
};

// static
vjs.Tracking.profiles_ = {};

vjs.Tracking.timeRE = /^(-?\d+(\.\d+)?)(%)?$/;

vjs.Tracking.getProfile = function(name) {
  return vjs.Tracking.profiles_[name];
};

vjs.Tracking.registerProfile = function(name, profile) {
  vjs.Tracking.profiles_[name] = profile;
};

vjs.Tracking.expandTimecode = function(duration, timecode) {
  var expanded = null;
  // [ whole match, timecode with decimal, decimal, percent sign ]
  timecode = ('' + timecode).match(this.timeRE);

  if (timecode !== null) {
    if (timecode[3] !== undefined) {
      expanded = this.expandPercent(parseInt(duration, 10), timecode[1]);
    }
    else {
      expanded = this.expandTime(parseInt(duration, 10), timecode[1]);
    }      
    expanded = Math.min(duration, expanded);
  }

  return expanded;
};

vjs.Tracking.expandPercent = function(duration, percent) {
  percent = Math.min(100, percent);
  if (percent < 0) {
    percent = 100 - percent;
  }
  return percent / 100 * duration;
};

vjs.Tracking.expandTime = function(duration, time) {
  return time >= 0 ? time : Math.max(0, duration - time);
};

// TrackingProfile
vjs.Tracking.TrackingProfile = vjs.CoreObject.extend({
  init: function(player, options) {
    this.player_ = player;

    this.options_ = vjs.obj.copy(this.options_);
    options = vjs.Component.prototype.options.call(this, options);

    this.el = document.createElement('div');

    this.proxies = {};

    var events = this.options.events,
        safeEvents = {},
        timeEvents = this.timeEvents = {};

    for (var key in events) {
      if (/^timeupdate\./.test(key)) {
        timeEvents[key] = events[key];
      }
      else {
        safeEvents[key] = events[key];
      }
    }
    
    this.setupHandlers(safeEvents);
    this.onLoadedmetadata = vjs.bind(this, (function(){
      var ran = false;
      return function() {
        if (ran) return;
        ran = true;
        this.setupTimeupdates.call(this);
      };
    }()));
    
    return this;
  },
  
  setupHandlers: function(events) {
    // keep track of event types used
    var eTypes = {};
    
    var type,
        contexts,
        c,
        handleName,
        ucType,
        i,
        l;
    
    for (type in events) {
      // make sure its an array
      contexts = [].concat(events[type]);
      
      ucType = vjs.capitalize(type);
      for (i = 0, l = contexts.length; i < l; i++) {
        c = contexts[i];
        handleName = c.handleName && this[c.handleName] ? c.handleName :
                     this['handle' + ucType] ? 'handle' + ucType :
                     null;
        if (handleName === null) {
          handleName = 'handleNoop';
          vjs.log('Missing handler for event type: ' + type);
        }

        this.on(type, this.bindHandler(handleName, c));
      }
      // use this later, ignore special events
      if (type.indexOf('.') === -1) eTypes[type] = 1;
    }

    var proxies = this.proxies;
    vjs.obj.each(eTypes, function(type){
      if (!proxies[type]) proxies[type] = vjs.bind(this, function(e){
        this.trigger(type, e);
      });
    }, this);

    return this;
  },

  setupTimeupdates: function() {
    var player = this.player_;
    player.off('loadedmetadata', this.onLoadedmetadata);
    var events = this.timeEvents,
        duration = player.duration(),
        newEvents = {},
        typeIndex,
        timeParts,
        context,
        handleName,
        ec,
        time;
    
    for (var type in events) {
      typeIndex = type.indexOf('.');
      if (typeIndex > 0) {
        timeParts = type.slice(typeIndex + 1),
            time = Tracking.expandTimecode(duration, timeParts);
        if (time === null) {
          vjs.log('Could not match timecode: ' + timeParts);
          continue;
        }
        
        // make sure there's no unexpected behavior with handle names
        context = [].concat(events[type]);
        handleName = 'handleTimeupdate.' + timeParts;
        for (var i = 0, l = context.length; i < l; i++) {
          ec = context[i];
          if (!ec.handleName) {
            ec.handleName = handleName;
          }
        }
        // add to existing expanded time if it exists
        handleName = 'timeupdate.' + Math.round(time);
        if (newEvents[handleName]) {
          newEvents[handleName].concat(context);
        }
        else {
          newEvents[handleName] = context;
        }
      }
    }
    this.setupHandlers(newEvents);
  },  

  // event methods
  on: function(type, fn, uid){
    vjs.on(this.el, type, vjs.bind(this, fn));
    return this;
  },

  off: function(type, fn){
    vjs.off(this.el, type, fn);
    return this;
  },

  trigger: function(type, e){
    vjs.trigger(this.el, type, e);
    return this;
  },
  // binds event proxies
  bind: function() {
    var player = this.player_;
    
    this.unbind();

    var proxies = this.proxies;
    for (var key in proxies) {
      player.on(key, proxies[key]);
    }

    // if we missed loadedmetadata
    if (player.duration() !== undefined) {
      this.onLoadedmetadata();
    } 
    else {
      player.on('loadedmetadata', this.onLoadedmetadata);
    }
    
    return this;
  },
  // unbinds event proxies
  unbind: function() {
    var player = this.player_,
        proxies = this.proxies;
    
    player.off('loadedmetadata', this.onLoadedmetadata);

    for (var key in proxies) {
      player.off(key, proxies[key]);
    }
    return this;
  },

  dispose: function() {
    // called when a profile is removed
    // or when the player is destroyed
    this.unbind();
  },

  // noop event handler
  handleNoop: function(event, context) {},
 
  // wraps handlers, passes them the event and context
  proxyHandler: function(handleName, context) {
    // merge global context into context object
    var context_ = vjs.obj.merge({}, this.options.context);
    context = vjs.obj.merge(context_, context);
    return function(event) {
      this[handleName].call(this, event, context);
    };
  }

});

vjs.Tracking.TrackingProfile.prototype.options_ = {
  context: {},
  events: {}
};

// Omniture profile
vjs.Tracking.OmnitureTrackingProfile = vjs.Tracking.TrackingProfile.extend({
  dispose: function() {
    vjs.Tracking.TrackingProfile.prototype.dispose.call(this);
    // if we don't explicitly stop omniture, it will
    // continue making tracking calls after player is gone
    var title = this.options.context.title;
    s.Media.stop(title, parseInt(this.player_.currentTime(), 10));
    s.Media.close(title);
    return this;
  },

  handlePlay: function(event, context) {
    if (!this.playing) {
      // begin playback
      var playCB = vjs.bind(this, function(){
        // reset omniture
        var s=s_gi(s_account);
        s.linkTrackVars = 'None';
        s.linkTrackEvents = 'None';
        s.linkTrackVars='prop1,prop4,prop5,prop9,prop10,prop16,prop17,prop18,prop19,prop20,prop21,prop22,eVar1,eVar4,eVar5,eVar9,eVar10,eVar16,eVar17,eVar18,eVar19,eVar20,eVar21,eVar22,events';
        s.linkTrackEvents='event1,event2,event3,event4,event5,event9,event14,event15';
        s.prop1=s.prop4=s.prop5=s.prop9=s.prop10=s.prop16=s.prop17=s.prop18=s.prop19=s.prop20=s.prop21=s.prop22=s.eVar1=s.eVar4=s.eVar5=s.eVar9=s.eVar10=s.eVar16=s.eVar17=s.eVar18=s.eVar19=s.eVar20=s.eVar21=s.eVar22='';
        s.events='';
        // and start tracking video
        this.playing = true;
        s.Media.open(context.title, this.player_.duration(), context.fileName);
        s.Media.play(context.title, 0);
      });
      // flash won't have the duration available when playback begins
      if (!this.player_.duration()) {
        this.player_.on('durationchange', this.delayPlay || (this.delayPlay = vjs.bind(this, function(){
          this.player_.off('durationchange', this.delayPlay);
          playCB();
        })));
      }
      else {
        playCB();
      }
    }
    else {
      // resume
      this.player_.on('timeupdate', this.trackResume || (this.trackResume = vjs.bind(this, function(){
        this.player_.off('timeupdate', this.trackResume);
        s.Media.play(context.title, parseInt(this.player_.currentTime(), 10));
      })));
    }
  },

  handlePause: function(event, context) {
    if (!this.player_.ended()) {
      this.pausedAt = parseInt(this.player_.currentTime(), 10);
      s.Media.stop(context.title, this.pausedAt);
    }
  },

  handleEnded: function(event, context) {
    // finish
    this.playing = false;
    this.pausedAt = null;
    s.Media.stop(context.title, parseInt(this.player_.currentTime(), 10));
    s.Media.close(context.title);
  }
});

vjs.Tracking.OmnitureTrackingProfile.prototype.options_ = {
  events: {
    play: {},
    pause: {},
    ended: {}
  }
};

vjs.Tracking.registerProfile('omniture15', vjs.Tracking.OmnitureTrackingProfile);

// webtrends profile
vjs.Tracking.WebtrendsTrackingProfile = vjs.Tracking.TrackingProfile.extend({
  handlePlay: function(event, context) {
    if (!this.playing) {
      this.playing = true;
      dcsMultiTrack.apply(null, context.args);
    }
  },

  handleEnded: function(event, context) {
    this.playing = false;
    dcsMultiTrack.apply(null, context.args);
  }
});

vjs.Tracking.WebtrendsTrackingProfile.prototype.options_ = {
  events: {
    play: {},
    ended: {}
  }
};

vjs.Tracking.registerProfile('webtrends', vjs.Tracking.WebtrendsTrackingProfile);

// Google analytics profile
vjs.Tracking.GATrackingProfile = vjs.Tracking.TrackingProfile.extend({
  getNamespace: function() {
    return window['_gaq'] || (window['_gaq'] = []);
  },

  handlePlay: function(event, context) {
    if (!this.playing) {
      this.playing = true;
      this.getNamespace().push(context.args);
    }
  },

  handleEnded: function(event, context) {
    this.playing = false;
    this.getNamespace().push(context.args);
  }
});

vjs.Tracking.GATrackingProfile.prototype.options_ = {
  events: {
    play: {},
    ended: {}
  }
};

vjs.Tracking.registerProfile('ga', vjs.Tracking.GATrackingProfile);

// register tracking plugin
vjs.plugin('tracking', function(options){
    this.tracking_ = new vjs.Tracking(this, options);
});