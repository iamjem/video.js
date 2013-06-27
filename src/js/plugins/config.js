vjs.withConfig = function(options, tag, addOptions, oldReady) {
  options = vjs.obj.merge({
    url: null,
    data: null,
    defaultId: null,
    onPlayer: function(player) {},
    onData: function(data){return data;},
    configOptions: {}
  }, options);
  
  // ensure addOptions exists
  if (!addOptions) {
    addOptions = {};
  }

  var success = function(data) {
    data = options.onData(data);
    
    var ready = function() {
      this.config_ = new vjs.Config(this, data, options.configOptions);
      if (oldReady) oldReady.call(this);
    };

    // merge global component data into addOptions components
    if (data.components) {
      if (!addOptions.children) addOptions.children = {};
      vjs.obj.merge(addOptions.children, vjs.Config.matchComponents(data.components));
    }
    
    // merge start video data, MINUS components
    if (options.defaultId !== null && data.videos) {
      var videos = data.videos,
          v;
      for (var i = 0, l = videos.length; i < l; i++) {
        v = videos[i];
        if (v.id === options.defaultId) {
          // remove component data w/o referencing the actual object
          if (v.children) {
            v = vjs.obj.merge({}, v);
            delete v.children;
          }
          vjs.obj.merge(addOptions, v);
          break;
        }
      }
    }

    var player = vjs(tag, addOptions, ready);
    options.onPlayer(player);
  };

  if (options.data !== null) {
    success(options.data);
  }
  else if (options.url !== null) {
    vjs.get(options.url, function(responseText){
      success(JSON.parse(responseText));
    });
  }
};

vjs.Config = vjs.Class.extend({
  init: function(player, data, options) {
    this.player = player;
    this.data = data;
    data.videos = data.videos || [];
    this.buildCache();
    return this;
  },
  buildCache: function() {
    // create ID cache
    var videos    = this.data.videos,
      idCache   = this.idCache_ = {},
      srcCache  = this.srcCache_ = {},
      cmpCache  = this.cmpCache_ = {};
    
    var video, i, l, srcs, src, j, k;
    for (i = 0, l = videos.length; i < l; i++) {
      video = videos[i];
      if (video.hasOwnProperty('id')) {
        idCache[video.id] = i;
        srcs = video.sources;
        if (srcs) {
          for (j = 0, k = srcs.length; j < k; j++) {
            srcCache[srcs[j].src] = i;
          }
        }
        // evaluate potential component media queries immediately
        // there's no way to swap or reload instantiated components
        // so we can't have totally 'responsive' components
        if (video.hasOwnProperty('components')) {
          cmpCache[video.id] = vjs.Config.matchComponents(video.components);
        }
      }
      else {
        vjs.log('Missing "id" attribute on a config\'s video object.');
      }
    }
    
    return this;
  },
  // get video data by id
  getById: function(id) {
    return this.idCache_.hasOwnProperty(id) ? this.data.videos[this.idCache_[id]] : null;
  },
  // get video data by src, can be a string or src object
  // will search on any format, getById is always faster
  getBySrc: function(src) {
    src = src.src || src;
    return this.srcCache_.hasOwnProperty(src) ? this.data.videos[this.srcCache_[src]] : null;
  },
  // get video data by current playing video
  getCurrent: function() {
    return this.getBySrc(this.player.currentSrc());
  },
  // get current video components, optionally pass property selector
  // to drill down further, ie: 'someComponent.someProp.anotherProp'
  getCurrentComponents: function(propSelector){
    var curr = this.getCurrent(),
        components = (curr !== null && curr.hasOwnProperty('components')) ? this.cmpCache_[curr.id] : null;
    
    if (components !== null && propSelector !== undefined) {
      var prop;
      propSelector = propSelector.split('.');
      for (var i = 0, l = propSelector.length; i < l; i++) {
        prop = propSelector[i];
        if (components.hasOwnProperty(prop)) {
          components = components[prop];
          continue;
        }
        else {
          components = null;
          break;
        }
      }
    }
    return components;
  },

  loadVideoById: function(id){
    var v = this.getById(id);
    if (v !== null && v.sources) {
      this.player.src(v.sources);
    }
  }
  
});

// choose the right components based on media queries
vjs.Config.matchComponents = function(components) {
  if (!window.matchMedia || !components.hasOwnProperty('default')) {
    return components['default'] || components;
  }
  for (var query in components) {
    if (window.matchMedia(query).matches) {
      return components[query];
    }
  }
  return components['default'];
};

vjs.ConfigPosterImage = vjs.PosterImage.extend({
  init: function(player, options){
    vjs.PosterImage.prototype.init.call(this, player, options);
    player.on('loadstart', vjs.proxy(this, this.onLoadstart));
    // flash
    player.on('onsrcchange', vjs.proxy(this, this.onLoadstart));
  },

  onLoadstart: function(){
    var config = this.player.config_.getCurrent();
    if (config !== null && config.poster && config.poster !== this.el.getAttribute('src')) {
      this.el.setAttribute('src', config.poster);
    }
  },

  onClick: function(){
    if(this.player.currentTime()) {
      this.player.currentTime(0);
    }
    this.player.play();
  }
});

// register plugin
vjs.plugin('config', function(options){
  this.config_ = new vjs.Config(this, options);
});