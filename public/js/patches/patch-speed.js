/* ============================================================
   検索成功率ブースター v2
   - 信頼度の高いインスタンスをプール先頭に追加
   - Piped/Invidious/Min-Pro を並列レースし、最速のヒットを採用
   - 既存 fetchFromInvidious はフォールバックとして残す
   ============================================================ */
(function(){
  // instances/invidious.json・piped.json からロード済みのリストをそのまま使用
// ---- 並列レース検索（最初に有効な結果を返したものを採用） ----
  function raceFirst(promises, timeoutMs){
    return new Promise(function(resolve){
      var done = false, remaining = promises.length;
      if (!remaining) return resolve(null);
      var timer = setTimeout(function(){ if(!done){ done=true; resolve(null);} }, timeoutMs||9000);
      promises.forEach(function(p){
        Promise.resolve(p).then(function(v){
          if (done) return;
          if (v && (Array.isArray(v) ? v.length : true)) {
            done = true; clearTimeout(timer); resolve(v);
          } else if (--remaining === 0 && !done) { done=true; clearTimeout(timer); resolve(null); }
        }).catch(function(){
          if (--remaining === 0 && !done) { done=true; clearTimeout(timer); resolve(null); }
        });
      });
    });
  }
  function mapPipedToInv(it){
    if (!it || !it.url) return null;
    var id = (it.url.match(/[?&]v=([\w-]{6,})/)||[])[1];
    if (!id) return null;
    return {
      type:'video', videoId:id,
      title: it.title||'',
      author: it.uploaderName||'',
      authorId: (it.uploaderUrl||'').replace(/^\/channel\//,''),
      authorThumbnails: it.uploaderAvatar ? [{url: it.uploaderAvatar}] : [],
      videoThumbnails: it.thumbnail ? [{url: it.thumbnail}] : [],
      lengthSeconds: it.duration||0,
      viewCount: it.views||0,
      publishedText: it.uploadedDate||'',
      liveNow: !!it.live
    };
  }
  function pipedSearch(query){
    var q = encodeURIComponent(query);
    return RELIABLE_PIPED.map(function(inst){
      return fetch(inst+'/search?q='+q+'&filter=videos', { signal: AbortSignal.timeout(5500) })
        .then(function(r){ if(!r.ok) throw 0; return r.json(); })
        .then(function(d){
          var arr = (d && (d.items||d)) || [];
          arr = arr.map(mapPipedToInv).filter(Boolean);
          if (!arr.length) throw 0;
          return arr;
        });
    });
  }
  function invidiousSearch(query, page){
    var path = '/api/v1/search?q='+encodeURIComponent(query)+'&page='+(page||1)+'&hl=ja&region=JP';
    var bf = (typeof window.buildFetchUrl==='function') ? window.buildFetchUrl : function(x){return x;};
    return RELIABLE_INV.map(function(inst){
      return fetch(bf(inst+path), { signal: AbortSignal.timeout(5500) })
        .then(function(r){ if(!r.ok) throw 0; return r.json(); })
        .then(function(d){ if(!Array.isArray(d)||!d.length) throw 0; return d; });
    });
  }
  function minproSearch(query){
    return [ fetch('https://min-pro.duckdns.org/api/search?q='+encodeURIComponent(query), { signal: AbortSignal.timeout(5500) })
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(d){ if(!d||!d.length) throw 0; return d; }) ];
  }
  // fetchFromInvidious をブースト版でラップ（検索時のみ）
  if (typeof window.fetchFromInvidious === 'function') {
    var _orig = window.fetchFromInvidious;
    window.fetchFromInvidious = async function(query, context, page){
      if (context !== 'search') return await _orig(query, context, page);
      var all = [].concat(
        invidiousSearch(query, page||1),
        pipedSearch(query),
        minproSearch(query)
      );
      var fast = await raceFirst(all, 7000);
      if (fast && fast.length) return fast;
      // フォールバック: 元実装（広範な CORSプロキシ＋全インスタンス）
      try { return await _orig(query, context, page); } catch(_) { return null; }
    };
  }
})();

// ===== 成功率の高いインスタンスを先頭に並べ替えて最速で取得 =====
(function(){
  function scoreHost(host){
    try {
      const s = (window._apiStats||{})[host];
      if (!s) return 0.5; // 未計測は中立
      const total = (s.ok||0) + (s.fail||0);
      if (total < 3) return 0.6; // サンプル不足は少し優遇
      return (s.ok||0) / total;
    } catch(e){ return 0.5; }
  }
  function hostOf(u){ try { return new URL(u, location.href).host; } catch(e){ return ''; } }
  function sortByScore(list){
    return list.slice().sort((a,b) => scoreHost(hostOf(b)) - scoreHost(hostOf(a)));
  }
  // getInvidiousFor をラップ → 成功率順 → 既存のユーザー優先順位は applyPriority が別途処理
  if (typeof window.getInvidiousFor === 'function') {
    const _orig = window.getInvidiousFor;
    window.getInvidiousFor = function(role){
      const arr = _orig(role) || [];
      return sortByScore(arr);
    };
  }
  // INVIDIOUS_INSTANCES 自体も先頭に高成功率を寄せる(検索パス用)
  try {
    if (Array.isArray(window.INVIDIOUS_INSTANCES)) {
      window.INVIDIOUS_INSTANCES = sortByScore(window.INVIDIOUS_INSTANCES);
    }
  } catch(e){}
  // 定期的に再ソート(統計が増えた後の最適化)
  setInterval(() => {
    try {
      if (Array.isArray(window.INVIDIOUS_INSTANCES)) {
        window.INVIDIOUS_INSTANCES = sortByScore(window.INVIDIOUS_INSTANCES);
      }
    } catch(e){}
  }, 15000);
})();

(function(){
  'use strict';
  var YT_KEY_STORAGE = 'ntube_youtube_api_key_v1';
  var YT_CHID_CACHE  = 'ntube_youtube_chid_cache_v1';
  function getYtKey(){
    try { return (localStorage.getItem(YT_KEY_STORAGE)||'').trim(); } catch(_) { return ''; }
  }
  function setYtKey(k){
    try { localStorage.setItem(YT_KEY_STORAGE, (k||'').trim()); } catch(_){}
  }
  function _chidCache(){
    try { return JSON.parse(localStorage.getItem(YT_CHID_CACHE)||'{}'); } catch(_) { return {}; }
  }
  function _saveChidCache(c){
    try { localStorage.setItem(YT_CHID_CACHE, JSON.stringify(c)); } catch(_){}
  }
  // ---------- 並列レース: N 件目までを最速で集める ----------
  // urls: [{url, parse}] 形式でも、文字列配列でもOK
  function parallelRaceJson(urls, opts){
    opts = opts || {};
    var want   = opts.want   || 1;      // 何件取れたら返すか
    var timeout= opts.timeout|| 4500;
    var validate = opts.validate || function(d){ return d != null; };
    var results = [];
    return new Promise(function(resolve){
      var done = false, settled = 0;
      var timer = setTimeout(function(){
        if (done) return; done = true;
        resolve(results);
      }, timeout);
      if (!urls.length){ clearTimeout(timer); return resolve([]); }
      urls.forEach(function(u){
        var url = (typeof u === 'string') ? u : u.url;
        fetch(url, { signal: AbortSignal.timeout(timeout) })
          .then(function(r){ if(!r.ok) throw 0; return r.json(); })
          .then(function(d){
            if (done) return;
            if (validate(d)){
              results.push(d);
              if (results.length >= want){
                done = true; clearTimeout(timer); resolve(results);
              }
            }
          })
          .catch(function(){})
          .finally(function(){
            settled++;
            if (!done && settled >= urls.length){
              done = true; clearTimeout(timer); resolve(results);
            }
          });
      });
    });
  }
  // Invidious 全インスタンス取得
  function _allInv(){
    try {
      if (Array.isArray(window.INVIDIOUS_INSTANCES) && window.INVIDIOUS_INSTANCES.length) return window.INVIDIOUS_INSTANCES.slice();
    } catch(_){}
    return [];
  }
  function _wrap(u){
    try { return (typeof buildFetchUrl === 'function') ? buildFetchUrl(u) : u; } catch(_) { return u; }
  }
  // ---------- YouTube Data API v3 ----------
  function ytApi(path, params){
    var key = getYtKey();
    var q = Object.keys(params||{}).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');
    return 'https://www.googleapis.com/youtube/v3/' + path + '?' + q + '&key=' + encodeURIComponent(key);
  }
  function ytFetch(path, params){
    return fetch(ytApi(path, params), { signal: AbortSignal.timeout(6000) })
      .then(function(r){ if(!r.ok) throw new Error('yt '+r.status); return r.json(); });
  }
  // ISO8601 -> 秒
  function isoToSec(iso){
    if(!iso) return 0;
    var m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
    if(!m) return 0;
    return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+parseInt(m[3]||0);
  }
  function relJa(tsSec){
    if(!tsSec) return '';
    var diff = Math.floor(Date.now()/1000) - tsSec;
    if (diff < 60) return diff+'秒前';
    if (diff < 3600) return Math.floor(diff/60)+'分前';
    if (diff < 86400) return Math.floor(diff/3600)+'時間前';
    if (diff < 86400*7) return Math.floor(diff/86400)+'日前';
    if (diff < 86400*30) return Math.floor(diff/86400/7)+'週間前';
    if (diff < 86400*365) return Math.floor(diff/86400/30)+'か月前';
    return Math.floor(diff/86400/365)+'年前';
  }
  // chName -> channelId (YouTube API)
  function ytResolveChannelId(name){
    var cache = _chidCache();
    if (cache[name]) return Promise.resolve(cache[name]);
    // search
    return ytFetch('search', { part:'snippet', type:'channel', q:name, maxResults:5, hl:'ja', regionCode:'JP' })
      .then(function(d){
        var items = (d && d.items) || [];
        // 完全一致を優先
        var norm = function(s){ return (s||'').toLowerCase().replace(/[\s\u3000@\-_]/g,''); };
        var t = norm(name);
        var pick = items.find(function(x){ return norm(x.snippet && x.snippet.channelTitle) === t; }) || items[0];
        var id = pick && pick.snippet && pick.snippet.channelId;
        if (id){ cache[name] = id; _saveChidCache(cache); }
        return id || null;
      });
  }
  // YouTube API: channel videos (詳細含む)
  function ytChannelVideos(channelName, page){
    page = page || 1;
    return ytResolveChannelId(channelName).then(function(chId){
      if(!chId) return null;
      // 1) channels → uploads playlist
      return ytFetch('channels', { part:'contentDetails,snippet,statistics,brandingSettings', id: chId })
        .then(function(c){
          var item = c.items && c.items[0];
          if(!item) return null;
          var uploads = item.contentDetails.relatedPlaylists.uploads;
          var sn = item.snippet || {}, st = item.statistics || {}, br = item.brandingSettings || {};
          var info = {
            authorId: chId,
            author: sn.title,
            authorHandle: sn.customUrl,
            description: sn.description || '',
            subCount: parseInt(st.subscriberCount||0),
            authorThumbnails: sn.thumbnails ? [{ url: (sn.thumbnails.high||sn.thumbnails.medium||sn.thumbnails.default||{}).url }] : null,
            authorBanners: (br.image && br.image.bannerExternalUrl) ? [{ url: br.image.bannerExternalUrl }] : null
          };
          // 2) playlistItems → videoIds
          return ytFetch('playlistItems', { part:'contentDetails,snippet', playlistId: uploads, maxResults: 50 })
            .then(function(pl){
              var ids = (pl.items||[]).map(function(x){ return x.contentDetails.videoId; });
              if(!ids.length) return { videos: [], channelInfo: info };
              // 3) videos.list で詳細(視聴回数/長さ/公開日)
              return ytFetch('videos', { part:'snippet,statistics,contentDetails,liveStreamingDetails', id: ids.join(',') })
                .then(function(vs){
                  var videos = (vs.items||[]).map(function(v){
                    var s = v.snippet||{}, st2 = v.statistics||{}, cd = v.contentDetails||{};
                    var ts = Math.floor(new Date(s.publishedAt).getTime()/1000);
                    var live = (s.liveBroadcastContent && s.liveBroadcastContent !== 'none');
                    return {
                      videoId: v.id,
                      title: s.title,
                      author: s.channelTitle,
                      authorId: s.channelId,
                      authorThumbnails: info.authorThumbnails,
                      description: s.description,
                      lengthSeconds: isoToSec(cd.duration),
                      viewCount: parseInt(st2.viewCount||0),
                      likeCount: parseInt(st2.likeCount||0),
                      published: ts,
                      publishedText: relJa(ts),
                      liveNow: s.liveBroadcastContent === 'live',
                      isUpcoming: s.liveBroadcastContent === 'upcoming'
                    };
                  });
                  return { videos: videos, channelInfo: info };
                });
            });
        });
    }).catch(function(e){ console.warn('[yt-api] channel fail', e); return null; });
  }
  // ---------- Invidious 並列レース版: チャンネル ID 解決 ----------
  function resolveChannelIdParallel(channelName){
    var inst = _allInv();
    if(!inst.length) return Promise.resolve(null);
    var urls = inst.map(function(i){
      return _wrap(i + '/api/v1/search?q=' + encodeURIComponent(channelName) + '&type=channel&page=1');
    });
    return parallelRaceJson(urls, {
      want: 8,
      timeout: 3500,
      validate: function(d){ return Array.isArray(d) && d.some(function(x){ return x && x.type==='channel' && x.authorId; }); }
    }).then(function(results){
      // 全候補をマージ
      var merged = [];
      results.forEach(function(arr){ arr.forEach(function(x){ if(x && x.type==='channel' && x.authorId) merged.push(x); }); });
      if(!merged.length) return null;
      var picker = (typeof _pickBestChannel === 'function') ? _pickBestChannel : function(l){ return l[0]; };
      var best = picker(merged, channelName);
      return best ? { id: best.authorId, channel: best } : null;
    });
  }
  // ---------- Invidious 並列: チャンネル動画 ----------
  function invChannelVideosParallel(channelName, page){
    page = page || 1;
    return resolveChannelIdParallel(channelName).then(function(r){
      if(!r) return null;
      var inst = _allInv();
      var urls = inst.map(function(i){
        return _wrap(i + '/api/v1/channels/' + r.id + '/videos?page=' + page + '&hl=ja&region=JP');
      });
      return parallelRaceJson(urls, {
        want: 8,
        timeout: 3500,
        validate: function(d){
          var v = d && (d.videos || d);
          return Array.isArray(v) && v.length > 0 && v[0].videoId;
        }
      }).then(function(results){
        if (!results.length) return null;
        // 各結果をマージしてベスト(視聴回数/公開日が入っている)を採用
        var byId = {};
        results.forEach(function(d){
          var arr = d && (d.videos || d);
          (arr||[]).forEach(function(v){
            if (!v || !v.videoId) return;
            var prev = byId[v.videoId];
            if (!prev) { byId[v.videoId] = v; return; }
            // viewCount / published を補完
            if (!prev.viewCount && v.viewCount) prev.viewCount = v.viewCount;
            if (!prev.published && v.published) prev.published = v.published;
            if (!prev.publishedText && v.publishedText) prev.publishedText = v.publishedText;
            if (!prev.lengthSeconds && v.lengthSeconds) prev.lengthSeconds = v.lengthSeconds;
            if (!prev.authorThumbnails && v.authorThumbnails) prev.authorThumbnails = v.authorThumbnails;
          });
        });
        var videos = Object.keys(byId).map(function(k){ return byId[k]; });
        return { videos: videos, channelInfo: r.channel };
      });
    });
  }
  // ---------- オーバーライド: fetchChannelVideos ----------
  var _origFetchChannelVideos = window.fetchChannelVideos;
  window.fetchChannelVideos = async function(channelName, page){
    page = page || 1;
    var key = getYtKey();
    if (key){
      try {
        var r = await Promise.race([
          ytChannelVideos(channelName, page),
          new Promise(function(res){ setTimeout(function(){ res(null); }, 5000); })
        ]);
        if (r && r.videos && r.videos.length) return r;
      } catch(_){}
    }
    // 並列レース
    try {
      var p = await Promise.race([
        invChannelVideosParallel(channelName, page),
        new Promise(function(res){ setTimeout(function(){ res(null); }, 4000); })
      ]);
      if (p && p.videos && p.videos.length) return p;
    } catch(_){}
    // 最後のフォールバック: オリジナル
    if (typeof _origFetchChannelVideos === 'function') return _origFetchChannelVideos(channelName, page);
    return null;
  };
  // ---------- オーバーライド: fetchChannelInfoFromInvidious (概要/バナー) ----------
  var _origFetchChannelInfo = window.fetchChannelInfoFromInvidious;
  window.fetchChannelInfoFromInvidious = async function(channelName){
    var key = getYtKey();
    if (key){
      try {
        var r = await ytChannelVideos(channelName, 1);
        if (r && r.channelInfo){
          var ci = r.channelInfo;
          // 形を Invidious 互換に
          return Object.assign({}, ci, { authorId: ci.authorId, type: 'channel' });
        }
      } catch(_){}
    }
    // 並列 ID 解決 → 全インスタンスで /channels/{id} を最速8件レース
    try {
      var rs = await resolveChannelIdParallel(channelName);
      if (rs){
        var inst = _allInv();
        var urls = inst.map(function(i){ return _wrap(i + '/api/v1/channels/' + rs.id); });
        var dets = await parallelRaceJson(urls, {
          want: 5, timeout: 4000,
          validate: function(d){ return d && (d.author || d.authorId); }
        });
        if (dets.length){
          // descriptionとバナーが入っているものを優先
          var best = dets.find(function(d){ return d.description && (d.authorBanners||[]).length>0; })
                  || dets.find(function(d){ return d.description; })
                  || dets[0];
          return Object.assign({}, rs.channel, best, { authorId: rs.id });
        }
        return rs.channel;
      }
    } catch(_){}
    if (typeof _origFetchChannelInfo === 'function') return _origFetchChannelInfo(channelName);
    return null;
  };
  // ---------- オーバーライド: fetchChannelLiveVideos ----------
  var _origFetchChannelLive = window.fetchChannelLiveVideos;
  window.fetchChannelLiveVideos = async function(channelName){
    try {
      var rs = await resolveChannelIdParallel(channelName);
      if (rs){
        var inst = _allInv();
        var urls = inst.map(function(i){ return _wrap(i + '/api/v1/channels/' + rs.id + '/streams'); });
        var results = await parallelRaceJson(urls, {
          want: 4, timeout: 3500,
          validate: function(d){ var v=d&&(d.videos||d); return Array.isArray(v) && v.length>0; }
        });
        var byId = {};
        results.forEach(function(d){
          var arr = d && (d.videos||d);
          (arr||[]).forEach(function(v){
            if (v && v.videoId && !byId[v.videoId]) byId[v.videoId] = Object.assign({ _sourceType:'stream' }, v);
          });
        });
        var vids = Object.keys(byId).map(function(k){ return byId[k]; });
        if (vids.length) return { videos: vids, channelInfo: rs.channel };
      }
    } catch(_){}
    if (typeof _origFetchChannelLive === 'function') return _origFetchChannelLive(channelName);
    return { videos: [], channelInfo: null };
  };
  // ---------- オーバーライド: fetchChannelShortsMultiPage ----------
  var _origShorts = window.fetchChannelShortsMultiPage;
  window.fetchChannelShortsMultiPage = async function(channelName, startPage){
    startPage = startPage || 1;
    try {
      var rs = await resolveChannelIdParallel(channelName);
      if (rs){
        var inst = _allInv();
        var pages = [startPage, startPage+1, startPage+2];
        var all = [];
        await Promise.all(pages.map(function(pg){
          var urls = inst.map(function(i){ return _wrap(i + '/api/v1/channels/' + rs.id + '/videos?page=' + pg); });
          return parallelRaceJson(urls, {
            want: 4, timeout: 3500,
            validate: function(d){ var v=d&&(d.videos||d); return Array.isArray(v) && v.length>0; }
          }).then(function(results){
            var byId = {};
            results.forEach(function(d){
              var arr = d && (d.videos||d);
              (arr||[]).forEach(function(v){ if(v&&v.videoId && !byId[v.videoId]) byId[v.videoId]=v; });
            });
            Object.keys(byId).forEach(function(k){ all.push(byId[k]); });
          });
        }));
        var shorts = all.filter(function(v){ return v.lengthSeconds>0 && v.lengthSeconds<=61; }).map(function(v){
          return { id:v.videoId, title:v.title, channel:v.author||channelName, isShort:true,
                   authorThumb:(v.authorThumbnails&&v.authorThumbnails[0])?v.authorThumbnails[0].url:('https://i.pravatar.cc/150?u='+encodeURIComponent(v.author||channelName)),
                   duration:v.lengthSeconds, published:v.publishedText||relJa(v.published||0), viewCount:v.viewCount||0 };
        });
        return { shorts: shorts, hasMore: all.length >= 20 };
      }
    } catch(_){}
    if (typeof _origShorts === 'function') return _origShorts(channelName, startPage);
    return { shorts: [], hasMore: false };
  };
  // ---------- 動画詳細(概要欄/視聴回数/投稿日) — 並列強化 ----------
  // 既存 getVideoData 等を補強: 概要欄が空のときに並列で再取得
  async function fetchVideoDetailParallel(videoId){
    var key = getYtKey();
    if (key){
      try {
        var d = await ytFetch('videos', { part:'snippet,statistics,contentDetails', id: videoId });
        var v = d && d.items && d.items[0];
        if (v){
          var s = v.snippet||{}, st = v.statistics||{}, cd = v.contentDetails||{};
          var ts = Math.floor(new Date(s.publishedAt).getTime()/1000);
          return {
            title: s.title, author: s.channelTitle, authorId: s.channelId,
            description: s.description, descriptionHtml: (s.description||'').replace(/\n/g,'<br>'),
            viewCount: parseInt(st.viewCount||0), likeCount: parseInt(st.likeCount||0),
            published: ts, publishedText: relJa(ts), lengthSeconds: isoToSec(cd.duration)
          };
        }
      } catch(_){}
    }
    var inst = _allInv();
    var urls = inst.map(function(i){
      return _wrap(i + '/api/v1/videos/' + videoId + '?fields=title,author,authorId,authorThumbnails,viewCount,likeCount,published,publishedText,description,descriptionHtml,lengthSeconds&hl=ja&region=JP');
    });
    var results = await parallelRaceJson(urls, {
      want: 8, timeout: 4000,
      validate: function(d){ return d && d.title; }
    });
    if (!results.length) return null;
    // フィールドをマージ(欠損補完)
    var out = {};
    results.forEach(function(d){
      Object.keys(d).forEach(function(k){
        if (out[k]==null || out[k]==='' || (typeof out[k]==='number' && out[k]===0)){
          if (d[k]!=null && d[k]!=='' && d[k]!==0) out[k] = d[k];
        }
      });
    });
    return out;
  }
  window.fetchVideoDetailParallel = fetchVideoDetailParallel;
  // 既存 description 表示の補強: 概要欄が空で表示されている場合に再取得して埋める
  function _hookDescription(){
    var desc = document.querySelector('.video-description');
    if (!desc) return;
    if (!window.currentVideoId) return;
    if (desc.dataset.vid === window.currentVideoId) return;
    desc.dataset.vid = window.currentVideoId;
    // 1秒待って空っぽなら補完
    setTimeout(function(){
      var text = (desc.innerText||'').replace(/\s/g,'');
      if (text.length > 10) return;
      fetchVideoDetailParallel(window.currentVideoId).then(function(d){
        if (!d || !d.description) return;
        if (window.currentVideoId !== desc.dataset.vid) return;
        var html = (d.descriptionHtml || (d.description||'').replace(/\n/g,'<br>'));
        // 既存の構造維持: 概要のテキスト部のみ更新
        var inner = desc.querySelector('.video-description-text') || desc.querySelector('.desc-body') || desc;
        if (inner === desc){
          var span = document.createElement('div');
          span.innerHTML = html;
          desc.innerHTML = '';
          desc.appendChild(span);
        } else {
          inner.innerHTML = html;
        }
        // 視聴回数/投稿日も補完
        try {
          var meta = document.querySelector('.video-stats') || document.querySelector('.video-meta');
          if (meta && d.viewCount && !/視聴/.test(meta.innerText)){
            meta.innerHTML = (d.viewCount.toLocaleString())+'回視聴 ・ '+(d.publishedText||'');
          }
        } catch(_){}
      });
    }, 1100);
  }
  // 動画ビューが開かれた時に発火
  var _origPlayVideo = window.playVideo;
  if (typeof _origPlayVideo === 'function'){
    window.playVideo = function(){
      var r = _origPlayVideo.apply(this, arguments);
      try { setTimeout(_hookDescription, 600); } catch(_){}
      return r;
    };
  }
  // ============ 設定 UI: YouTube API キー欄を追加 ============
  function injectSettingsUI(){
    var panel = document.querySelector('#view-settings .settings-panel');
    if (!panel) return false;
    if (panel.querySelector('[data-ntube-ytkey]')) return true;
    var sec = document.createElement('div');
    sec.className = 'settings-section';
    sec.setAttribute('data-ntube-ytkey','1');
    sec.innerHTML =
      '<div class="settings-section-title">YouTube Data API キー</div>' +
      '<div class="setting-item" style="flex-direction:column;align-items:stretch;gap:10px;">' +
        '<div class="setting-info">' +
          '<div class="setting-title">API キー（任意）</div>' +
          '<div class="setting-desc">入力して「完了」を押すと、このキーを使って動画情報を取得します。空欄なら従来通り並列レースで取得します。</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          '<input id="ntube-ytkey-input" type="text" autocomplete="off" spellcheck="false" placeholder="AIza..." ' +
            'style="flex:1;min-width:220px;padding:10px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--bg-color);color:var(--text-color);font-size:14px;">' +
          '<button id="ntube-ytkey-save" style="padding:10px 18px;border-radius:10px;border:none;background:var(--text-color);color:var(--bg-color);font-weight:600;cursor:pointer;">完了</button>' +
          '<button id="ntube-ytkey-clear" style="padding:10px 14px;border-radius:10px;border:1px solid var(--border-color);background:transparent;color:var(--text-color);cursor:pointer;">クリア</button>' +
        '</div>' +
        '<div id="ntube-ytkey-status" style="font-size:12px;color:var(--text-secondary);"></div>' +
      '</div>';
    // 「登録チャンネル管理」のセクションの直前に挿入(末尾でも可)
    var subsSec = panel.querySelector('.settings-section:last-child');
    if (subsSec) panel.insertBefore(sec, subsSec); else panel.appendChild(sec);
    var input = sec.querySelector('#ntube-ytkey-input');
    var status = sec.querySelector('#ntube-ytkey-status');
    var cur = getYtKey();
    if (cur){ input.value = cur; status.textContent = '✓ 保存済み (API キー使用中)'; }
    else status.textContent = '未設定 — 並列レースで取得します';
    sec.querySelector('#ntube-ytkey-save').onclick = function(){
      var v = (input.value||'').trim();
      setYtKey(v);
      status.textContent = v ? '✓ 保存しました (API キー使用中)' : '✓ クリアしました — 並列レースで取得します';
      // キャッシュもクリアして次回新規取得
      try { localStorage.removeItem(YT_CHID_CACHE); } catch(_){}
    };
    sec.querySelector('#ntube-ytkey-clear').onclick = function(){
      input.value = ''; setYtKey('');
      status.textContent = '✓ クリアしました — 並列レースで取得します';
      try { localStorage.removeItem(YT_CHID_CACHE); } catch(_){}
    };
    return true;
  }
  function trySettingsInject(){
    if (injectSettingsUI()) return;
    setTimeout(trySettingsInject, 400);
  }
  // ナビゲーションを監視
  var _origNav = window.navigate;
  if (typeof _origNav === 'function'){
    window.navigate = function(){
      var r = _origNav.apply(this, arguments);
      try { setTimeout(trySettingsInject, 50); } catch(_){}
      return r;
    };
  }
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(trySettingsInject, 200); });
  setTimeout(trySettingsInject, 1500);
  console.log('[ntube-overlay] 並列高速取得 + YouTube API キー対応 を有効化');
})();

/* ===== 仲良しTube v1.7.4 パッチ =====
   - 古い「API 優先度 (上が高優先)」UIを撤去
   - 全APIへ並行ping → 速い順 top8 を優先使用
   - Shorts: 表示外は確実に停止 / iframe再利用 / バグ低減
   - /#/plus-home ルーティング
*/
(function(){
  'use strict';
  /* --- 1) 古い「API 優先度 (上が高優先)」UI を完全に無効化 --- */
  try {
    if (typeof window.injectApiProviderUI === 'function') {
      window.injectApiProviderUI = function(){};
    }
  } catch(_){}
  function removeOldApiPriorityUI(){
    document.querySelectorAll('#api-provider-priority').forEach(el => el.remove());
    // テキストで該当する古いタイトルが残っていれば取り除く
    document.querySelectorAll('#view-settings div').forEach(el => {
      if (el.children.length === 0 && /API 優先度 \(上が高優先\)/.test(el.textContent||'')) {
        const box = el.closest('div[id="api-provider-priority"]') || el.parentElement;
        if (box && box.id === 'api-provider-priority') box.remove();
      }
    });
  }
  setInterval(removeOldApiPriorityUI, 1500);
  /* --- 2) 全API並行ping → 最速 top8 を優先 --- */
  const SPEED_KEY = 'nyt_api_speed_top_v1';
  const SPEED_TS  = 'nyt_api_speed_ts_v1';
  function loadFastList(){
    try { return JSON.parse(localStorage.getItem(SPEED_KEY)||'[]'); } catch(_) { return []; }
  }
  function saveFastList(list){
    try { localStorage.setItem(SPEED_KEY, JSON.stringify(list)); localStorage.setItem(SPEED_TS, String(Date.now())); } catch(_) {}
  }
  function pingOne(base){
    return new Promise(resolve => {
      const url = base.replace(/\/+$/,'') + '/api/v1/stats';
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(()=>{ ctrl.abort(); resolve({base, ms: 99999}); }, 4000);
      fetch(url, {signal: ctrl.signal, cache:'no-store', mode:'cors'})
        .then(r => { clearTimeout(timer); resolve({base, ms: r.ok ? (performance.now()-t0) : 99999}); })
        .catch(()=>{ clearTimeout(timer); resolve({base, ms: 99999}); });
    });
  }
  async function measureAllApis(){
    const list = (window.INVIDIOUS_INSTANCES||[]).slice(0, 60);
    if (!list.length) return;
    const results = await Promise.all(list.map(pingOne));
    const top = results.filter(r => r.ms < 99999).sort((a,b)=>a.ms-b.ms).slice(0,8).map(r=>r.base);
    if (top.length){
      saveFastList(top);
      // 既存配列の先頭に最速8を差し込み (重複除去)
      const seen = new Set(top);
      const rest = (window.INVIDIOUS_INSTANCES||[]).filter(x => !seen.has(x));
      window.INVIDIOUS_INSTANCES = top.concat(rest);
      console.log('[v1.7.4] fastest 8 APIs:', top);
    }
  }
  function maybeMeasure(){
    const ts = +(localStorage.getItem(SPEED_TS)||0);
    const cached = loadFastList();
    if (cached.length === 8) {
      const seen = new Set(cached);
      const rest = (window.INVIDIOUS_INSTANCES||[]).filter(x => !seen.has(x));
      window.INVIDIOUS_INSTANCES = cached.concat(rest);
    }
    if (Date.now() - ts > 10*60*1000) {  // 10分毎
      setTimeout(measureAllApis, 1500);
    }
  }
  setTimeout(maybeMeasure, 800);
  /* --- 3) Shorts 安定化: 表示外は強制停止 & 再開時のみ src 復帰 --- */
  function killAllShortsOffscreen(){
    const container = document.getElementById('shorts-container');
    if (!container) return;
    const items = container.querySelectorAll('.short-snap-item');
    const vh = window.innerHeight;
    items.forEach(item => {
      const r = item.getBoundingClientRect();
      const visible = r.top < vh*0.6 && r.bottom > vh*0.4;
      if (!visible) {
        const iframe = item.querySelector('iframe');
        if (iframe && iframe.src && !iframe.src.includes('about:blank')) {
          if (!iframe.dataset.savedSrc) iframe.dataset.savedSrc = iframe.src;
          iframe.src = 'about:blank';
        }
        item.querySelectorAll('video,audio').forEach(el => { try{ el.pause(); }catch(_){} });
      } else {
        const iframe = item.querySelector('iframe');
        if (iframe && iframe.src.includes('about:blank') && iframe.dataset.savedSrc) {
          iframe.src = iframe.dataset.savedSrc;
        }
      }
    });
  }
  let _shortsTick = null;
  function startShortsWatcher(){
    if (_shortsTick) return;
    _shortsTick = setInterval(() => {
      if (document.getElementById('view-shorts')?.classList.contains('active')) {
        killAllShortsOffscreen();
      }
    }, 600);
  }
  startShortsWatcher();
  // スクロール時にもチェック
  document.addEventListener('scroll', () => {
    if (document.getElementById('view-shorts')?.classList.contains('active')) killAllShortsOffscreen();
  }, {passive:true, capture:true});
  /* --- 4) /#/plus-home & /#/gust ルーティング --- */
  function setChromeHidden(hidden){
    const hdr = document.querySelector('header');
    const sb = document.getElementById('sidebar');
    const mc = document.getElementById('main-content');
    const cats = document.getElementById('categories-bar');
    if (hidden) {
      if (hdr) hdr.style.display = 'none';
      if (sb) sb.style.display = 'none';
      if (cats) cats.style.display = 'none';
      if (mc) { mc.style.padding = '0'; mc.style.marginLeft = '0'; mc.style.marginTop = '0'; mc.style.width = '100%'; }
      document.body.classList.add('chrome-hidden');
    } else {
      if (hdr) hdr.style.display = '';
      if (sb) sb.style.display = '';
      if (cats) cats.style.display = '';
      if (mc) { mc.style.padding = ''; mc.style.marginLeft = ''; mc.style.marginTop = ''; mc.style.width = ''; }
      document.body.classList.remove('chrome-hidden');
    }
  }
  function activateView(id){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const v = document.getElementById(id);
    if (v) v.classList.add('active');
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    window.scrollTo(0,0);
  }
  const EXT_SOURCES = {
    gust: 'https://raw.githubusercontent.com/nautilus-os/GUST/refs/heads/main/index.html'
  };
  const _extCache = {};
  async function loadExt(name){
    const frame = document.getElementById(name+'-frame');
    const loading = document.getElementById(name+'-loading');
    if (!frame) return;
    if (frame.dataset.loaded === '1') { if (loading) loading.style.display='none'; return; }
    if (loading) loading.style.display = 'flex';
    try {
      let html = _extCache[name];
      if (!html) {
        const proxies = [
          u => u,
          u => 'https://corsproxy.io/?' + encodeURIComponent(u),
          u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)
        ];
        let lastErr;
        for (const p of proxies) {
          try {
            const r = await fetch(p(EXT_SOURCES[name]), {cache:'no-store'});
            if (r.ok) { html = await r.text(); break; }
          } catch(e){ lastErr = e; }
        }
        if (!html) throw lastErr || new Error('fetch failed');
        _extCache[name] = html;
      }
      frame.srcdoc = html;
      frame.dataset.loaded = '1';
      frame.onload = () => { if (loading) loading.style.display='none'; };
    } catch(e){
      if (loading) loading.textContent = 'Failed to load: ' + e.message;
    }
  }
  function showPlusHome(){ setChromeHidden(true); activateView('view-plus-home'); }
  function showExt(name){ setChromeHidden(true); activateView('view-'+name); loadExt(name); }
  function checkHashRoute(){
    const h = location.hash;
    if (h === '#/plus-home') showPlusHome();
    else if (h === '#/gust') showExt('gust');
    else {
      // restore chrome if leaving these special routes
      if (document.body.classList.contains('chrome-hidden')) {
        setChromeHidden(false);
        ['view-plus-home','view-gust'].forEach(id=>{
          const e=document.getElementById(id); if(e) e.classList.remove('active');
        });
      }
    }
  }
  window.addEventListener('hashchange', checkHashRoute);
  document.addEventListener('DOMContentLoaded', () => setTimeout(checkHashRoute, 300));
  setTimeout(checkHashRoute, 1200);
  // navigate() が呼ばれたら 特殊ビューを解除
  const _on = window.navigate;
  if (typeof _on === 'function') {
    window.navigate = function(v){
      if (v !== 'plus-home' && v !== 'gust') {
        ['view-plus-home','view-gust'].forEach(id=>{
          const e=document.getElementById(id); if(e) e.classList.remove('active');
        });
        if (document.body.classList.contains('chrome-hidden')) setChromeHidden(false);
      }
      return _on.apply(this, arguments);
    };
  }
  console.log('[仲良しTube v1.7.6] パッチ適用完了');
})();

/* ============================================================
 * Invidious 高速ヘルス & 役割分担 v2 (2026-05)
 *  - 死亡インスタンスを並列検出 → 永続ブラックリスト (10分)
 *  - 生存インスタンスを応答速度順に常時ランキング
 *  - 役割 (trend/search/shorts/channel/video) ごとに自動分配
 *  - 動画ストリーム取得を最速インスタンス群でレース (目標 0.2s)
 * ============================================================ */
(function(){
  'use strict';
  if (!Array.isArray(window.INVIDIOUS_INSTANCES) || !window.INVIDIOUS_INSTANCES.length) return;
  const DEAD_KEY  = '__inv_dead_v2';
  const ALIVE_KEY = '__inv_alive_v2';
  const DEAD_TTL   = 10 * 60 * 1000;   // 死亡判定 10分
  const ALIVE_TTL  =  2 * 60 * 1000;   // 生存ランキング 2分
  const PROBE_TIMEOUT = 1200;          // ping タイムアウト
  const STREAM_PER_TRY = 1500;         // 各 instance のストリーム取得タイムアウト
  const STREAM_OVERALL = 3500;         // 全体安全網
  const ALIVE_TOP = 12;                // 上位 N 件を保持
  /* ---- 永続キャッシュ ---- */
  function loadDead(){
    try {
      const o = JSON.parse(sessionStorage.getItem(DEAD_KEY)||'{}');
      const now = Date.now();
      for (const k in o) if (o[k] < now) delete o[k];
      return o;
    } catch(_) { return {}; }
  }
  function saveDead(o){ try { sessionStorage.setItem(DEAD_KEY, JSON.stringify(o)); } catch(_){} }
  function markDead(base){ const d = loadDead(); d[base] = Date.now()+DEAD_TTL; saveDead(d); }
  function isDead(base){ const d = loadDead(); return d[base] && d[base] > Date.now(); }
  function loadAlive(){
    try {
      const o = JSON.parse(sessionStorage.getItem(ALIVE_KEY)||'null');
      if (!o || (Date.now()-o.t) > ALIVE_TTL) return null;
      return o.list;
    } catch(_) { return null; }
  }
  function saveAlive(list){ try { sessionStorage.setItem(ALIVE_KEY, JSON.stringify({t:Date.now(),list})); } catch(_){} }
  let _aliveList = loadAlive();        // [base,...] 速い順
  let _probing = null;
  /* ---- 高速 ping (HEAD 不可なので軽量GET) ---- */
  function probe(base){
    const url = base.replace(/\/$/,'') + '/api/v1/stats';
    const ctrl = new AbortController();
    const t0 = performance.now();
    const to = setTimeout(()=>ctrl.abort(), PROBE_TIMEOUT);
    return fetch(url,{signal:ctrl.signal,cache:'no-store',mode:'cors'})
      .then(r=>{ clearTimeout(to); if(!r.ok) throw 0; return {base, ms: performance.now()-t0}; })
      .catch(e=>{ clearTimeout(to); throw e; });
  }
  function refreshAlive(force){
    if (!force && _aliveList && _aliveList.length) return Promise.resolve(_aliveList);
    if (_probing) return _probing;
    const dead = loadDead();
    const pool = window.INVIDIOUS_INSTANCES.filter(b => !(dead[b] && dead[b]>Date.now()));
    const results = [];
    let remaining = pool.length;
    _probing = new Promise(resolve=>{
      let done = false;
      const finish = ()=>{
        if (done) return; done = true;
        results.sort((a,b)=>a.ms-b.ms);
        const list = results.slice(0, ALIVE_TOP).map(x=>x.base);
        if (list.length) { _aliveList = list; saveAlive(list); }
        _probing = null;
        resolve(_aliveList || []);
      };
      if (!pool.length) return finish();
      pool.forEach(base=>{
        probe(base)
          .then(r=>{
            results.push(r);
            // 上位 N が揃った瞬間に早期確定
            if (results.length >= ALIVE_TOP) finish();
          })
          .catch(()=>{ markDead(base); })
          .finally(()=>{ if (--remaining <= 0) finish(); });
      });
      // 全体保険
      setTimeout(finish, PROBE_TIMEOUT + 400);
    });
    return _probing;
  }
  /* ---- 起動時 + 定期再計測 ---- */
  refreshAlive(false);
  setInterval(()=>refreshAlive(true), 90*1000);
  /* ---- 役割分担: 生存リストをラウンドロビンで配る ---- */
  function aliveByRole(role){
    const list = (_aliveList && _aliveList.length) ? _aliveList.slice() : window.INVIDIOUS_INSTANCES.slice(0,12);
    if (list.length <= 2) return list;
    // role に応じてオフセットして「同じ最速」だけに集中しないよう分担
    const offsets = { trend:0, search:1, shorts:2, channel:3, video:0 };
    const off = offsets[role] || 0;
    const rotated = list.slice(off).concat(list.slice(0, off));
    return rotated;
  }
  /* ---- getInvidiousFor を最終ラップ: 死亡除外 + 生存優先 ---- */
  if (typeof window.getInvidiousFor === 'function') {
    const prev = window.getInvidiousFor;
    window.getInvidiousFor = function(role){
      const dead = loadDead();
      const alive = aliveByRole(role);
      const fallback = (prev(role)||[]).filter(b => !(dead[b] && dead[b]>Date.now()));
      const seen = new Set(); const out = [];
      for (const u of alive.concat(fallback)) {
        if (u && !seen.has(u)) { seen.add(u); out.push(u); }
      }
      return out.length ? out : fallback;
    };
  }
  /* ---- 動画ストリーム取得を 0.2秒目標でレース ---- */
  const buildUrl = (typeof window.buildFetchUrl==='function') ? window.buildFetchUrl : (x=>x);
  window.fetchGoogleVideoStreamsInvidious = async function(videoId){
    // 最速生存リストが未取得なら短時間だけ待つ
    if (!_aliveList || !_aliveList.length) {
      await Promise.race([refreshAlive(false), new Promise(r=>setTimeout(r,250))]);
    }
    const dead = loadDead();
    let pool = (_aliveList||[]).filter(b => !(dead[b] && dead[b]>Date.now()));
    if (pool.length < 4) {
      // 補強: 役割pool + 全体先頭
      const extra = (window.getInvidiousFor ? window.getInvidiousFor('video') : window.INVIDIOUS_INSTANCES.slice(0,12));
      const seen = new Set(pool);
      for (const u of extra) { if (!seen.has(u) && !(dead[u] && dead[u]>Date.now())) { pool.push(u); seen.add(u);} }
    }
    pool = pool.slice(0, 14);
    const controller = new AbortController();
    const tasks = pool.map(inst => (async () => {
      const u = buildUrl(`${inst}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams`);
      const perCtrl = new AbortController();
      const onAbort = ()=>perCtrl.abort();
      controller.signal.addEventListener('abort', onAbort, {once:true});
      const to = setTimeout(()=>perCtrl.abort(), STREAM_PER_TRY);
      try {
        const r = await fetch(u, {signal: perCtrl.signal});
        clearTimeout(to);
        if (!r.ok) { if (r.status>=500||r.status===0) markDead(inst); throw 0; }
        const d = await r.json();
        const formats = [...(d.adaptiveFormats||[]), ...(d.formatStreams||[])];
        if (!formats.length) throw 0;
        return formats;
      } catch(e) {
        clearTimeout(to);
        if (perCtrl.signal.aborted && !controller.signal.aborted) markDead(inst);
        throw e;
      }
    })());
    const overall = new Promise((_,rej)=>setTimeout(()=>rej(0), STREAM_OVERALL));
    try {
      const formats = await Promise.race([Promise.any(tasks), overall]);
      controller.abort();
      return formats;
    } catch(_) {
      controller.abort();
      return null;
    }
  };
  console.info('[InvHealth v2] 役割分担 + 0.2秒レース有効化 (instances:',
    window.INVIDIOUS_INSTANCES.length, ')');
})();

// ===== 検索時にショート & チャンネルを必ず表示 =====
(function(){
  function fireShortsAndChannels(q){
    if (!q) return;
    try { if (typeof fetchShortsForSearch === 'function') fetchShortsForSearch(q); } catch(_){}
    try {
      if (typeof searchChannelsFromInvidious === 'function' && typeof renderSearchChannels === 'function') {
        searchChannelsFromInvidious(q, 5).then(renderSearchChannels).catch(()=>{});
      }
    } catch(_){}
  }
  function wrap(){
    if (typeof window.handleSearch !== 'function') return false;
    const orig = window.handleSearch;
    window.handleSearch = function(e, externalQuery){
      const r = orig.apply(this, arguments);
      try {
        const q = externalQuery || (document.getElementById('search-input')||{}).value;
        if (q) {
          fireShortsAndChannels(q);
          // データ取得が遅延しても確実に出すため再試行
          setTimeout(()=>fireShortsAndChannels(q), 1500);
          setTimeout(()=>fireShortsAndChannels(q), 4000);
        }
      } catch(_){}
      return r;
    };
    return true;
  }
  if (!wrap()) {
    const t = setInterval(()=>{ if (wrap()) clearInterval(t); }, 100);
    setTimeout(()=>clearInterval(t), 15000);
  }
})();

/* ============ 仲良しTube plus v1.7.9 速度&UIパッチ ============ */
(function(){
  'use strict';
  try { document.title = '仲良しTube plus'; } catch(e){}
  /* ---- 1. YouTube風 ヘッダー微調整 ---- */
  var ytCss = document.createElement('style');
  ytCss.textContent = ''
    + '.yt-style-logo .logo-text{font-family:"Roboto","YouTube Sans","Arial",sans-serif !important;font-weight:700 !important;letter-spacing:-1.2px !important;}'
    + 'header{height:56px;}'
    + '.search-bar input{border-radius:40px 0 0 40px !important;}'
    + '.search-bar button{border-radius:0 40px 40px 0 !important;background:var(--hover-color) !important;border-left:1px solid var(--search-border) !important;}'
    + '.video-card .video-title{font-weight:500;line-height:1.3;}'
    + '';
  document.head.appendChild(ytCss);
  /* ---- 2. 並列分割ダウンロード(Range)で mp4 を高速取得 ---- */
  // CORSプロキシ候補(既存と同じ思想)
  var CHUNK_PROXIES = [
    '',                                  // 直 (CORS通れば最速)
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://api.allorigins.win/raw?url='
  ];
  function _proxify(url, proxy){
    if (!proxy) return url;
    return proxy + (proxy.endsWith('=') ? encodeURIComponent(url) : url);
  }
  // HEAD で Content-Length と Range サポートを取得 (どの proxy が動くかも判定)
  async function probe(url){
    for (var i=0;i<CHUNK_PROXIES.length;i++){
      var px = CHUNK_PROXIES[i];
      try {
        var r = await fetch(_proxify(url, px), { method:'GET', headers:{ Range:'bytes=0-0' }, signal: AbortSignal.timeout(8000) });
        if (!r.ok && r.status !== 206) continue;
        var cr = r.headers.get('content-range'); // "bytes 0-0/12345"
        var total = 0;
        if (cr){ var m = cr.match(/\/(\d+)/); if (m) total = parseInt(m[1],10); }
        if (!total) total = parseInt(r.headers.get('content-length')||'0',10);
        if (total && r.status === 206) return { proxy: px, total: total };
      } catch(e){}
    }
    return null;
  }
  async function fetchRange(url, start, end, proxy){
    var r = await fetch(_proxify(url, proxy), { headers:{ Range:'bytes='+start+'-'+end }, signal: AbortSignal.timeout(30000) });
    if (!r.ok && r.status !== 206) throw new Error('range '+r.status);
    return await r.arrayBuffer();
  }
  // 公開: 並列N分割ダウンロード → blob URL
  window.parallelFetchToBlob = async function(url, opts){
    opts = opts || {};
    var parts = opts.parts || 6;        // 並列数
    var onProgress = opts.onProgress;
    var info = await probe(url);
    if (!info) throw new Error('probe failed');
    var total = info.total, proxy = info.proxy;
    var size = Math.ceil(total / parts);
    var ranges = [];
    for (var i=0;i<parts;i++){
      var s = i*size, e = Math.min(total-1, (i+1)*size - 1);
      if (s <= e) ranges.push([s,e]);
    }
    var done = 0;
    var bufs = await Promise.all(ranges.map(function(rg){
      return fetchRange(url, rg[0], rg[1], proxy).then(function(b){
        done += b.byteLength;
        if (onProgress) try{ onProgress(done/total); }catch(_){}
        return b;
      });
    }));
    var blob = new Blob(bufs, { type:'video/mp4' });
    return URL.createObjectURL(blob);
  };
  /* ---- 3. 360p mixed を優先採用 + 並列取得で差し替え ---- */
  // 既存 renderSiawaseokPlayer の挙動を後段でフック:
  //   <video id="gv-video"> に muxed mp4 が直 src されたら、
  //   並列取得した blob URL に差し替えて高速化
  var _swapInflight = new WeakSet();
  function swapToParallel(videoEl){ return; /* disabled: 動画停止時の再読み込みを無効化 */
    /* original body kept below but unreachable */
    if(false){
    if (!videoEl || _swapInflight.has(videoEl)) return;
    var src = videoEl.currentSrc || (videoEl.querySelector('source') && videoEl.querySelector('source').src);
    if (!src || src.startsWith('blob:')) return;
    if (!/\.mp4(\?|$)/i.test(src) && src.indexOf('mime=video%2Fmp4')<0 && src.indexOf('itag=18')<0 && src.indexOf('itag=22')<0) return;
    _swapInflight.add(videoEl);
    var savedTime = videoEl.currentTime || 0;
    window.parallelFetchToBlob(src, { parts: 6 }).then(function(blobUrl){
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.querySelectorAll('source').forEach(function(s){ s.remove(); });
        videoEl.src = blobUrl;
        videoEl.load();
        videoEl.currentTime = savedTime;
        videoEl.play().catch(function(){});
        console.log('[仲良しTube plus 並列] 高速差し替え完了');
      } catch(e){ console.warn('[並列差し替え失敗]', e); }
    }).catch(function(e){ console.warn('[並列取得失敗]', e); _swapInflight.delete(videoEl); });
    } /* end if(false) */
  }
  // player-wrapper の DOM変化を監視して、新しい <video> を見つけたら並列化を試みる
  var obs = new MutationObserver(function(){
    var v = document.getElementById('gv-video');
    if (v && !v.dataset.parallelTried){
      v.dataset.parallelTried = '1';
      // 1秒だけ待ってから差し替え(初回再生が即始まる体感のため)
      setTimeout(function(){ swapToParallel(v); }, 800);
    }
  });
  function bindObs(){
    var w = document.getElementById('player-wrapper');
    if (w) obs.observe(w, { childList:true, subtree:true });
    else setTimeout(bindObs, 500);
  }
  bindObs();
  /* ---- 4. デフォルト画質を 360p に強制 ---- */
  try {
    Object.defineProperty(window, 'selectedQuality', {
      configurable: true,
      get(){ return this.__sq || '360p'; },
      set(v){ this.__sq = v; }
    });
  } catch(e){}
  // 既存の selectedQuality 変数は別スコープなので、初期化フックとして
  // 設定画面のデフォルト画質も 360p に
  try {
    var dq = document.querySelector('select[id*="quality"], select[name*="quality"]');
    if (dq) { dq.value = '360p'; }
  } catch(e){}
  console.log('[仲良しTube plus v1.8.1] 速度&UIパッチ適用完了');
})();

