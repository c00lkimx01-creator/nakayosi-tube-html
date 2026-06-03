// ===== Phase A scripts =====
(function(){
  'use strict';
  // --- Voice search ---
  window.startVoiceSearch = function(){
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR){ alert('このブラウザは音声認識に対応していません'); return; }
    var btn = document.getElementById('voice-search-btn');
    var rec = new SR();
    rec.lang = 'ja-JP'; rec.interimResults = false; rec.maxAlternatives = 1;
    btn && btn.classList.add('listening');
    rec.onresult = function(e){
      var t = e.results[0][0].transcript;
      var inp = document.getElementById('search-input');
      if (inp){ inp.value = t; try{ inp.form.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true})); }catch(_){ if (typeof handleSearch==='function') handleSearch({preventDefault:function(){}, target:inp.form}); } }
    };
    rec.onerror = function(){ btn && btn.classList.remove('listening'); };
    rec.onend = function(){ btn && btn.classList.remove('listening'); };
    try{ rec.start(); }catch(_){ btn && btn.classList.remove('listening'); }
  };
  // --- First-visit banner (show until user dismisses or searches) ---
  var FVB_KEY = 'fvbDismissed_v1';
  function maybeShowFVB(){
    if (localStorage.getItem(FVB_KEY)) return;
    var hist = [];
    try { hist = JSON.parse(localStorage.getItem('watchHistory')||'[]'); } catch(_){}
    if (hist.length === 0) {
      var b = document.getElementById('first-visit-banner');
      if (b) b.style.display = 'flex';
    }
  }
  window.dismissFirstVisitBanner = function(){
    localStorage.setItem(FVB_KEY, '1');
    var b = document.getElementById('first-visit-banner');
    if (b) b.style.display = 'none';
  };
  setTimeout(maybeShowFVB, 300);
  document.addEventListener('submit', function(e){
    if (e.target && e.target.classList && e.target.classList.contains('search-bar')) {
      window.dismissFirstVisitBanner();
    }
  }, true);
  // --- MyPage navigation hook ---
  var _origNavigate = window.navigate;
  window.navigate = function(view, opts){
    // Always clear any inline display set by previous mypage activation
    document.querySelectorAll('.view').forEach(function(v){ v.style.display=''; });
    if (view === 'mypage') {
      document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
      var mp = document.getElementById('view-mypage');
      if (mp){ mp.classList.add('active'); }
      document.querySelectorAll('.sidebar-item').forEach(function(i){ i.classList.remove('active'); });
      var nm = document.getElementById('nav-mypage'); if (nm) nm.classList.add('active');
      try { renderMyPage(); } catch(e){ console.warn(e); }
      try {
        var cb = document.getElementById('categories-bar');
        if (cb) cb.style.display = 'none';
      } catch(_){}
      if (!opts || !opts.noHistory) {
        try { history.pushState({view:'mypage'}, '', '#/mypage'); } catch(_){}
      }
      return;
    }
    return _origNavigate ? _origNavigate.apply(this, arguments) : undefined;
  };
  function renderMyPage(){
    var hist = []; var subs = []; var pls = [];
    try { hist = JSON.parse(localStorage.getItem('watchHistory')||'[]'); } catch(_){}
    try { subs = JSON.parse(localStorage.getItem('subscriptions')||'[]'); } catch(_){}
    try { pls = JSON.parse(localStorage.getItem('playlists')||'[]'); } catch(_){}
    var stats = document.getElementById('mypage-stats');
    if (stats) {
      stats.innerHTML = [
        ['視聴動画数', hist.length],
        ['登録チャンネル', subs.length],
        ['再生リスト', Array.isArray(pls)?pls.length:Object.keys(pls||{}).length],
        ['初回訪問', localStorage.getItem('firstVisitDate') || '今日']
      ].map(function(p){
        return '<div class="mypage-stat-card"><div class="num">'+p[1]+'</div><div class="lbl">'+p[0]+'</div></div>';
      }).join('');
    }
    var recent = document.getElementById('mypage-recent');
    if (recent) {
      if (!hist.length) {
        recent.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">まだ視聴履歴がありません</div>';
      } else {
        recent.innerHTML = hist.slice(0, 12).map(function(v){
          var vid = v.id || v.videoId; var title = v.title||''; var ch = v.channel||v.author||'';
          var thumb = 'https://i.ytimg.com/vi/'+vid+'/mqdefault.jpg';
          return '<div class="video-card" onclick="playVideo(\''+vid+'\')">'
            + '<div class="thumbnail-container"><img loading="lazy" src="'+thumb+'" alt=""></div>'
            + '<div class="video-info"><div class="video-details">'
            + '<div class="video-title">'+escapeHtml(title)+'</div>'
            + '<div class="video-meta-channel"><span>'+escapeHtml(ch)+'</span></div>'
            + '</div></div></div>';
        }).join('');
      }
    }
    if (!localStorage.getItem('firstVisitDate')) {
      var d = new Date(); localStorage.setItem('firstVisitDate', d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate());
    }
  }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  window.mypageClearHistory = function(){
    if (!confirm('視聴履歴をすべて削除しますか？')) return;
    try { localStorage.removeItem('watchHistory'); } catch(_){}
    renderMyPage();
  };
  window.mypageExport = function(){
    var data = {};
    ['watchHistory','subscriptions','playlists','appConfig'].forEach(function(k){
      try { data[k] = JSON.parse(localStorage.getItem(k)||'null'); } catch(_){}
    });
    var blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nakayosi-tube-data.json';
    a.click();
  };
  // Hash routing for mypage
  if (location.hash === '#/mypage') setTimeout(function(){ window.navigate('mypage', {noHistory:true}); }, 500);
})();

/* ===== Premium+ 高速化レイヤ (SWR + キャッシュ + 先読み) ===== */
(function(){
  try {
    var MEM = new Map();
    var TTL = 5*60*1000; // 5分
    var SS = (function(){ try { return window.sessionStorage; } catch(e){ return null; } })();
    function ckey(u){ return 'pp_c_' + u; }
    function getCache(u){
      var m = MEM.get(u);
      if (m && (Date.now()-m.t) < TTL) return m.v;
      if (SS) {
        try { var s = SS.getItem(ckey(u)); if (s){ var o = JSON.parse(s); if ((Date.now()-o.t) < TTL){ MEM.set(u,o); return o.v; } } } catch(e){}
      }
      return null;
    }
    function setCache(u,v){
      var o = {t:Date.now(), v:v};
      MEM.set(u,o);
      if (SS) { try { SS.setItem(ckey(u), JSON.stringify(o)); } catch(e){} }
    }
    var _origFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = (init && init.method) || (input && input.method) || 'GET';
        var cacheable = method === 'GET' && /\/api\/v1\/(trending|popular|search|videos|channels)/.test(url);
        if (cacheable) {
          var hit = getCache(url);
          if (hit) {
            // SWR: バックグラウンドで更新
            _origFetch(input, init).then(function(r){ return r.clone().json().then(function(j){ setCache(url, j); }).catch(function(){}); }).catch(function(){});
            return Promise.resolve(new Response(JSON.stringify(hit), {status:200, headers:{'Content-Type':'application/json'}}));
          }
          return _origFetch(input, init).then(function(r){
            try { r.clone().json().then(function(j){ if (j) setCache(url, j); }).catch(function(){}); } catch(e){}
            return r;
          });
        }
      } catch(e){}
      return _origFetch(input, init);
    };

    // 画像の優先度を上げて初回表示を高速化
    document.addEventListener('DOMContentLoaded', function(){
      try {
        var imgs = document.querySelectorAll('.thumbnail-container img');
        for (var i=0;i<Math.min(6,imgs.length);i++){ imgs[i].setAttribute('fetchpriority','high'); imgs[i].loading='eager'; }
      } catch(e){}
    });

    // requestIdleで関連先をpreconnect
    var idle = window.requestIdleCallback || function(fn){ return setTimeout(fn, 200); };
    idle(function(){
      try {
        var hosts = (window.INVIDIOUS_INSTANCES||[]).slice(0,12);
        hosts.forEach(function(h){
          var l = document.createElement('link');
          l.rel = 'preconnect'; l.href = h; l.crossOrigin = '';
          document.head.appendChild(l);
        });
      } catch(e){}
    });
  } catch(e){ console.warn('[premium-speed] init failed', e); }
})();