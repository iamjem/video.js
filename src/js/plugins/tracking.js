vjs.Tracking =  vjs.Component.extend({
  init: function(player, options) {
    vjs.Component.prototype.init.call(this, player, options);
    
    this.currId_ = null;
    this.lastTimeupdate_ = null;
    this.activeProfiles_ = [];
    this.globalProfiles_ = [];

    // handle global profiles
    var profiles = this.options_.profiles;
    if (profiles.length) {
      profiles = this.globalProfiles_ = this.initProfiles(profiles);
      this.addProfiles(profiles, true);
    }

    this.player_.on('loadstart', vjs.bind(this, this.onLoadstart));
  },

  addProfiles: function(profiles, global) {
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
        profiles[i].onDispose();
      }
      this.activeProfiles_ = [];
    }
    else {
      profiles = this.globalProfiles_;
      for (var i = 0, l = profiles.length; i < l; i++) {
        profiles[i].onDispose();
      }
      this.globalProfiles_ = [];
    }

    return this;
  },

  // take raw profile options, create and return instances
  initProfiles: function(profileData) {
    var profiles = [];
    var player = this.player_;
    var p;
    var pClass;

    for (var i = 0, l = profileData.length; i < l; i++) {
      p = profileData[i];
      if (p['profileName']) {
        pClass = vjs.Tracking.getProfile(p['profileName']);
        if (pClass !== undefined) {
          profiles.push(new pClass(player, p));
        }
        else {
          vjs.log('Could not find profile with name: ' + p['profileName']);
        }
      }
    }
  
    return profiles;
  },

  onLoadstart: function(e) {
    this.removeProfiles();
    this.lastTimeupdate_ = null;

    var player = this.player_;
    var current = player.config_.getCurrent();
    var profiles;

    if (current === null || current['id'] === this.currId_) {
        return this;
    }

    this.currId_ = current['id'];
    profiles = player.config_.getCurrentConfig('tracking.profiles');
    if (profiles !== null) {
      profiles = this.initProfiles(profiles);
      this.addProfiles(profiles);
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

    this.lastTimeupdate_ = null;
    this.hasPlayed_ = false;
    this.el_ = document.createElement('div');
    
    this.eventHandlers_ = {};
    this.customEventHandlers_ = {};

    this.onLoadedmetadata = vjs.bind(this, this.onLoadedmetadata);
    this.onTimeupdate = vjs.bind(this, this.onTimeupdate);
    this.onDispose = vjs.bind(this, this.onDispose);

    this.player_.on('dispose', this.onDispose);
    this.parseEvents();

    // if we missed loadedmetadata
    if (player.duration() !== undefined) {
      this.onLoadedmetadata();
    }
    else {
      player.one('loadedmetadata', this.onLoadedmetadata);
    }

    return this;
  },
  
  parseEvents: function(){
    var events = this.options_['events'];
    var safeEvents = {};
    var timeEvents = this.timeEvents_ = {};

    for (var key in events) {
      if (/^timeupdate\./.test(key)) {
        timeEvents[key] = events[key];
      }
      else {
        safeEvents[key] = events[key];
      }
    }

    this.setupHandlers(safeEvents);
  },

  setupHandlers: function(events) {
    var normalHandlers = this.eventHandlers_;
    var customHandlers = this.customEventHandlers_;
    var handlers;
    var type;
    var contexts;
    var c;
    var handleName;
    var ucType;
    var i;
    var l;

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

        if (type.indexOf('.') === -1) {
          handlers = normalHandlers;
        }
        else {
          handlers = customHandlers;
        }
        handlers[type] = handlers[type] || [];
        handlers[type].push(this.bindHandler(handleName, c));
      }
    }

    return this;
  },

  setupTimeupdates: function() {
    var player = this.player_;
    var events = this.timeEvents_;
    var duration = player.duration();
    var newEvents = {};
    var typeIndex;
    var timeParts;
    var context;
    var handleName;
    var ec;
    var time;
    var hasTimeupdate = false;
    
    for (var type in events) {
      typeIndex = type.indexOf('.');
      if (typeIndex > 0) {
        timeParts = type.slice(typeIndex + 1),
            time = Tracking.expandTimecode(duration, timeParts);
        if (time === null) {
          vjs.log('Could not match timecode: ' + timeParts);
          continue;
        }
        hasTimeupdate = true;
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

    if (hasTimeupdate) {
      this.eventHandlers_['timeupdate'] = this.eventHandlers_['timeupdate'] || [];
      this.eventHandlers_['timeupdate'].push(this.onTimeupdate);
      this.setupHandlers(newEvents);
    }
  },

  on: function(type, fn, uid){
    vjs.on(this.el_, type, vjs.bind(this, fn));
    return this;
  },

  off: function(type, fn){
    vjs.off(this.el_, type, fn);
    return this;
  },

  trigger: function(type, e){
    vjs.trigger(this.el_, type, e);
    return this;
  },
  // binds profile events
  bind: function() {
    var player = this.player_;

    this.unbind();

    var events = this.eventHandlers_;
    var handlers;
    var i;

    for (var key in events) {
      handlers = events[key];
      for (i = handlers.length - 1; i >= 0; i--) {
          player.on(key, handlers[i]);
      }
    }

    events = this.customEventHandlers_;
    for (var key in events) {
      handlers = events[key];
      for (i = handlers.length - 1; i >= 0; i--) {
          this.on(key, handlers[i]);
      }
    }

    return this;
  },
  // unbinds profile events
  unbind: function() {
    var player = this.player_;
    var events = this.eventHandlers_;
    var handlers;

    for (var key in events) {
      handlers = events[key];
      for (i = handlers.length - 1; i >= 0; i--) {
          player.off(key, handlers[i]);
      }
    }

    this.off();

    return this;
  },

  // noop event handler
  handleNoop: function(event, context) {},
 
  // wraps handlers, passes them the event and context
  bindHandler: function(handleName, context) {
    // merge global context into context object
    var context_ = vjs.obj.merge({}, this.options_['context']);
    context = vjs.obj.merge(context_, context);
    return vjs.bind(this, function(event) {
      this[handleName].call(this, event, context);
    });
  },

  onDispose: function() {
    // called when a profile is removed
    // or when the player is destroyed
    this.unbind();
  },

  onLoadedmetadata: function() {
    this.setupTimeupdates();
    var wasPlaying = !this.player_.paused();
    this.bind();
    // we missed the first play event?
    // race conditions abound...
    if (wasPlaying && this.eventHandlers_['play']) {
      var handlers = this.eventHandlers_['play'];
      var event = { type: 'play', target: this.player_.el_ };
      event = vjs.fixEvent(event);
      for (var i = handlers.length - 1; i >= 0; i--) {
        handlers[i](event);
      }
    }
  },

  onTimeupdate: function() {
    var curr = Math.round(this.player_.currentTime());
    if (this.lastTimeupdate_ !== curr) {
      this.lastTimeupdate_ = curr;
      this.trigger('timeupdate.' + curr, e);
    }
  }

});

vjs.Tracking.TrackingProfile.prototype.options_ = {};
vjs.Tracking.TrackingProfile.prototype.options_['context'] = {};
vjs.Tracking.TrackingProfile.prototype.options_['events'] = {};

// Omniture profile
vjs.Tracking.OmnitureTrackingProfile = vjs.Tracking.TrackingProfile.extend({
  init: function(player, options){
    this.namespace = window['s']['Media'];
    this.handleDurationchange_ = vjs.bind(this, this.handleDurationchange_);
    this.handlePlay_ = vjs.bind(this, this.handlePlay_);
    this.handleResume_ = vjs.bind(this, this.handleResume_);
    vjs.Tracking.TrackingProfile.prototype.init.call(this, player, options);
  },

  onDispose: function() {
    vjs.Tracking.TrackingProfile.prototype.onDispose.call(this);
    // if we don't explicitly stop omniture, it will
    // continue making tracking calls after player is gone
    var title = this.options_['context']['title'];
    this.namespace['stop'](title, parseInt(this.player_.currentTime(), 10));
    this.namespace['close'](title);
    return this;
  },

  handleResume_: function(){
    this.player_.off('timeupdate', this.handleResume_);
    this.namespace['play'](this.playContext_['title'], parseInt(this.player_.currentTime(), 10));
  },

  handleDurationchange_: function(){
    this.player_.off('durationchange', this.handleDurationchange_);
    this.handlePlay_();
  },

  handlePlay_: function(){
    // reset omniture
    var s=window['s_gi'](window['s_account']);
    s.linkTrackVars = 'None';
    s.linkTrackEvents = 'None';
    s.linkTrackVars='prop1,prop4,prop5,prop9,prop10,prop16,prop17,prop18,prop19,prop20,prop21,prop22,eVar1,eVar4,eVar5,eVar9,eVar10,eVar16,eVar17,eVar18,eVar19,eVar20,eVar21,eVar22,events';
    s.linkTrackEvents='event1,event2,event3,event4,event5,event9,event14,event15';
    s.prop1=s.prop4=s.prop5=s.prop9=s.prop10=s.prop16=s.prop17=s.prop18=s.prop19=s.prop20=s.prop21=s.prop22=s.eVar1=s.eVar4=s.eVar5=s.eVar9=s.eVar10=s.eVar16=s.eVar17=s.eVar18=s.eVar19=s.eVar20=s.eVar21=s.eVar22='';
    s.events='';
    // and start tracking video
    this.playing_ = true;
    this.namespace['open'](this.playContext_['title'], this.player_.duration(), this.playContext_['fileName']);
    this.opened_ = true;
    this.namespace['play'](this.playContext_['title'], 0);
  },

  handlePlay: function(event, context) {
    this.playContext_ = context;
    if (!this.playing_) {
      // flash won't have the duration available when playback begins
      if (!this.player_.duration()) {
        this.player_.on('durationchange', this.handleDurationchange_);
      }
      else {
        this.handlePlay_();
      }
    }
    else {
      // resume
      this.player_.on('timeupdate', this.handleResume_);
    }
  },

  handlePause: function(event, context) {
    if (!this.player_.ended()) {
      this.pausedAt_ = parseInt(this.player_.currentTime(), 10);
      this.namespace['stop'](context['title'], this.pausedAt_);
    }
  },

  handleEnded: function(event, context) {
    // finish
    if (this.opened_) {
      this.opened_ = false;
      this.playing_ = false;
      this.pausedAt_ = null;
      this.player_.off('timeupdate', this.handleResume_);
      this.namespace['stop'](context['title'], parseInt(this.player_.currentTime(), 10));
      this.namespace['close'](context['title']);
    }
  }
});

vjs.Tracking.OmnitureTrackingProfile.prototype.options_ = {};
vjs.Tracking.OmnitureTrackingProfile.prototype.options_['events'] = {};
vjs.Tracking.OmnitureTrackingProfile.prototype.options_['events']['play'] = {};
vjs.Tracking.OmnitureTrackingProfile.prototype.options_['events']['pause'] = {};
vjs.Tracking.OmnitureTrackingProfile.prototype.options_['events']['ended'] = {};


vjs.Tracking.registerProfile('omniture15', vjs.Tracking.OmnitureTrackingProfile);

// webtrends profile
vjs.Tracking.WebtrendsTrackingProfile = vjs.Tracking.TrackingProfile.extend({
  getNamespace: function() {
    return window['dcsMultiTrack'];
  },

  handlePlay: function(event, context) {
    if (!this.playing_) {
      this.playing_ = true;
      this.getNamespace().apply(null, context['args']);
    }
  },

  handleEnded: function(event, context) {
    this.playing_ = false;
    this.getNamespace().apply(null, context['args']);
  }
});

vjs.Tracking.WebtrendsTrackingProfile.prototype.options_ = {
  events: {
    'play': {},
    'ended': {}
  }
};

vjs.Tracking.registerProfile('webtrends', vjs.Tracking.WebtrendsTrackingProfile);

// Google analytics profile
vjs.Tracking.GATrackingProfile = vjs.Tracking.TrackingProfile.extend({
  getNamespace: function() {
    return window['_gaq'] || (window['_gaq'] = []);
  },

  handlePlay: function(event, context) {
    if (!this.playing_) {
      this.playing_ = true;
      this.getNamespace().push(context['args']);
    }
  },

  handleEnded: function(event, context) {
    this.playing_ = false;
    this.getNamespace().push(context['args']);
  }
});

vjs.Tracking.GATrackingProfile.prototype.options_ = {
  events: {
    play: {},
    ended: {}
  }
};

vjs.Tracking.registerProfile('ga', vjs.Tracking.GATrackingProfile);