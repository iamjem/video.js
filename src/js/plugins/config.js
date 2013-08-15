vjs.ConfigPlayer = vjs.Player.extend({
  init: function(configFactory, tag, options, ready){
    this.config_ = configFactory(this);
    vjs.Player.prototype.init.call(this, tag, options, ready);
  }
});

vjs.withConfig = function(options, tag, addOptions, ready) {
  options = vjs.obj.merge({
    url: null,
    data: null,
    defaultId: null,
    onPlayer: function(player) {},
    onData: function(data){return data;},
    configOptions: {}
  }, options);

  // ensure minimal addOptions
  addOptions = vjs.obj.merge({
    children: {},
    plugins: {}
  }, addOptions || {});

  // ajax success callback
  var success = function(data) {
    data = options.onData(data);

    // merge global components into addOptions
    if (data.children) {
      vjs.obj.merge(addOptions.children, vjs.Config.matchOptions(data.children));
    }

    // merge global plugins into addOptions
    if (data.plugins) {
      vjs.obj.merge(addOptions.plugins, vjs.Config.matchOptions(data.plugins));
    }

    // merge start video options
    if (options.defaultId !== null && data.videos) {
      var videos = data.videos, v;
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

    var configFactory = vjs.Config.configFactory({ data: data });
    var player = new vjs.ConfigPlayer(configFactory, tag, addOptions, ready);
    options.onPlayer(player);
  };

  // data was manually passed in
  if (options.data !== null) {
    success(options.data);
  }
  // data requires AJAX get
  else if (options.url !== null) {
    vjs.get(options.url, function(responseText){
      success(JSON.parse(responseText));
    });
  }
};

vjs.Config = vjs.CoreObject.extend({
  init: function(player, options) {
    this.player = player;
    this.options_ = vjs.obj.deepMerge(this.options_, options || {});
    this.data = this.options_.data;
    this.buildCache();
    return this;
  },
  buildCache: function() {
    // create ID cache
    var videos = this.data.videos,
        idCache = this.idCache_ = {},
        srcCache = this.srcCache_ = {};

    var video,
        i = 0, l = videos.length,
        j, k,
        srcs, src;

    for (; i < l; i++) {
      video = videos[i];
      if (video.hasOwnProperty('id')) {
        idCache[video.id] = i;
        srcs = video.sources;
        if (srcs) {
          for (j = 0, k = srcs.length; j < k; j++) {
            srcCache[srcs[j].src] = i;
          }
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

  getOptions_: function(obj, selector){
    var selected = obj, prop;
    selector = selector.split('.');

    for (var i = 0, l = selector.length; i < l; i++) {
      prop = selector[i];
      if (selected.hasOwnProperty(prop)) {
        selected = selected[prop];
        continue;
      }
      else {
        selected = null;
        break;
      }
    }
    
    return selected;
  },

  getCurrentChildren: function(selector){
    var curr = this.getCurrent();
    if (curr !== null && curr.hasOwnProperty('children')) {
      return (selector) ? this.getOptions_(curr.children, selector) : curr.children;
    }
    return null;
  },

  getCurrentConfig: function(selector){
    var curr = this.getCurrent();
    if (curr !== null && curr.hasOwnProperty('config')) {
      return (selector) ? this.getOptions_(curr.config, selector) : curr.config;
    }
    return null;
  },

  loadVideoById: function(id){
    var v = this.getById(id);
    if (v !== null && v.sources) {
      this.player.src(v.sources);
    }
  }
  
});

vjs.Config.prototype.options_ = {
  data: {
    videos: []
  }
};

vjs.Config.configFactory = function(options){
  return function(player){
    return new vjs.Config(player, options);
  };
};

// choose the right options based on media queries
vjs.Config.matchOptions = function(obj) {
  if (!window.matchMedia || !obj.hasOwnProperty('default')) {
    return obj['default'] || obj;
  }
  for (var query in obj) {
    if (window.matchMedia(query).matches) {
      return obj[query];
    }
  }
  return obj['default'];
};

// register plugin
vjs.plugin('config', function(options){
  this.config_ = new vjs.Config(this, options);
});

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