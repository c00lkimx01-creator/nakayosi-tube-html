// =================== ショートストリーム (3タイプ: NC/Edu/Manifest) ===================
function buildShortNocookieSrc(videoId) {
  // 音あり再生対応 (mute=0)。ブラウザの自動再生制限がかかる場合はユーザー操作で再生。
  const m = window._shortMuted ? 1 : 0;
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${m}&loop=1&playlist=${videoId}&rel=0&enablejsapi=1`;
}
function buildShortEduSrc(videoId, key) {
  if (!key) return buildShortNocookieSrc(videoId);
  const cfg = encodeURIComponent(JSON.stringify({enc: key, hideTitle: true}));
  return `https://www.youtubeeducation.com/embed/${videoId}?autoplay=1&origin=https%3A%2F%2Fcreate.kahoot.it&embed_config=${cfg}`;
}
function renderShorts(videos, append = false) {
  const container = document.getElementById('shorts-container');
  if (!append) { container.innerHTML = ''; currentShortItems = []; initShortObserver(); }
  currentShortItems = [...currentShortItems, ...videos];
  videos.forEach(v => {
    const item = document.createElement('div');
    item.className = 'short-snap-item'; item.dataset.id = v.id;
    const channelSafe = (v.channel||'').replace(/'/g,"\\'");
    const titleSafe = (v.title||'').replace(/</g,'&lt;');
    const initialSrc = buildShortNocookieSrc(v.id);
    shortSrcMap[v.id] = initialSrc;
    const likeCount = Math.floor(Math.random()*50000)+100;
    const likeStr = likeCount >= 10000 ? (likeCount/1000).toFixed(0)+'K' : likeCount.toLocaleString();
    const subbed = isSubscribed(v.channel||'');
    item.innerHTML = `
      <div class="short-center">
        <div class="short-video-wrap" id="short-wrap-${v.id}">
          <iframe src="about:blank" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
          <div class="short-stream-selector">
            <button class="short-stream-btn ${shortStreamType===1?'active':''}" onclick="changeShortStream(1,'${v.id}')">NC</button>
            <button class="short-stream-btn ${shortStreamType===2?'active':''}" onclick="changeShortStream(2,'${v.id}')">Edu</button>
            <button class="short-stream-btn ${shortStreamType===3?'active':''}" onclick="changeShortStream(3,'${v.id}')">MF</button>
          </div>
          <div class="short-overlay-bottom">
            <div class="short-channel" onclick="openChannel('${channelSafe}','${v.authorThumb||''}')">
              <img src="${v.authorThumb||`https://i.pravatar.cc/80?u=${v.channel}`}" onerror="this.src='https://i.pravatar.cc/80?u=${encodeURIComponent(v.channel||'')}'">
              <span class="short-channel-name">${v.channel||''}</span>
              <button class="short-sub-btn ${subbed?'subscribed':''}" id="short-sub-btn-${v.id}" onclick="event.stopPropagation();toggleSubscribeFromShort('${channelSafe}','${v.authorThumb||''}',this)">${subbed?'登録済み':'登録'}</button>
            </div>
            <div class="short-title">${titleSafe}</div>
          </div>
        </div>
        <div class="short-side-actions">
          <div class="short-action-btn" onclick="openChannel('${channelSafe}','${v.authorThumb||''}')">
            <div class="icon short-avatar-btn">
              <img src="${v.authorThumb||`https://i.pravatar.cc/80?u=${v.channel}`}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" onerror="this.src='https://i.pravatar.cc/48?u=${encodeURIComponent(v.channel||'')}'">
            </div>
          </div>
          <div class="short-action-btn" onclick="toggleShortLike(this)">
            <div class="icon"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg></div>
            <span class="short-like-count">${likeStr}</span>
          </div>
          <div class="short-action-btn" onclick="toggleShortDislike(this)">
            <div class="icon"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg></div>
            <span>低評価</span>
          </div>
          <div class="short-action-btn" onclick="openShortComments('${v.id}','${titleSafe}')">
            <div class="icon"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg></div>
            <span>コメント</span>
          </div>
          <div class="short-action-btn" onclick="shareShort('${v.id}')">
            <div class="icon"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg></div>
            <span>共有</span>
          </div>
          <div class="short-action-btn" onclick="playVideo('${v.id}','${titleSafe}','${channelSafe}','${v.authorThumb||''}')">
            <div class="icon"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg></div>
            <span>詳細</span>
          </div>
          <div class="short-action-btn" onclick="downloadShort('${v.id}')">
            <div class="icon"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></div>
            <span>DL</span>
          </div>
        </div>
      </div>
      <div class="short-comments-panel" id="short-comments-panel-${v.id}" style="display:none;position:absolute;bottom:0;left:0;right:0;height:65%;background:var(--bg-color);border-radius:16px 16px 0 0;z-index:20;overflow-y:auto;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-weight:bold;">
          <span>コメント</span>
          <button onclick="closeShortComments('${v.id}')" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-color);">×</button>
        </div>
        <div id="short-comments-content-${v.id}" class="loader">読み込み中...</div>
      </div>
    `;
    container.appendChild(item);
    observeShortItem(item);
  });
  document.getElementById('shorts-loader').classList.add('hidden');
}
function downloadShort(videoId) {
  window.open(`https://cobalt.tools/?url=https://www.youtube.com/shorts/${videoId}`, '_blank');
}
// changeShortStream: 3タイプのみ (m3u8=type4 削除、3=Manifest Hunter)
async function changeShortStream(type, targetVideoId) {
  shortStreamType = type;
  const config = getAppConfig(); config.shortStream = type;
  localStorage.setItem('study2525_config', JSON.stringify(config));
  for (const v of currentShortItems) {
    const wrap = document.getElementById(`short-wrap-${v.id}`);
    if (!wrap) continue;
    wrap.querySelectorAll('.short-stream-btn').forEach((b, i) => b.classList.toggle('active', i+1 === type));
  }
  if (type === 1) {
    // Nocookie
    for (const v of currentShortItems) {
      const newSrc = buildShortNocookieSrc(v.id);
      shortSrcMap[v.id] = newSrc;
      const wrap = document.getElementById(`short-wrap-${v.id}`);
      if (!wrap) continue;
      wrap.querySelectorAll('video, audio, .short-gv-loading').forEach(el => el.remove());
      let iframe = wrap.querySelector('iframe');
      if (!iframe) { iframe = document.createElement('iframe'); iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'; iframe.allowFullscreen = true; wrap.insertBefore(iframe, wrap.firstChild); }
      iframe.style.display = ''; iframe.src = newSrc;
    }
  } else if (type === 2) {
    // Edu
    if (!currentEduKey) currentEduKey = await fetchKahootKey();
    if (!currentEduKey) { alert("Edu準備中"); shortStreamType = 1; changeShortStream(1, targetVideoId); return; }
    for (const v of currentShortItems) {
      const newSrc = buildShortEduSrc(v.id, currentEduKey);
      shortSrcMap[v.id] = newSrc;
      const wrap = document.getElementById(`short-wrap-${v.id}`);
      if (!wrap) continue;
      wrap.querySelectorAll('video, audio, .short-gv-loading').forEach(el => el.remove());
      let iframe = wrap.querySelector('iframe');
      if (!iframe) { iframe = document.createElement('iframe'); iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'; iframe.allowFullscreen = true; wrap.insertBefore(iframe, wrap.firstChild); }
      iframe.style.display = '';
      if (iframe.src && iframe.src !== 'about:blank') iframe.src = newSrc;
    }
  } else if (type === 3) {
    // Manifest Hunter (siawaseok deepSearch)
    for (const v of currentShortItems) {
      const wrap = document.getElementById(`short-wrap-${v.id}`);
      if (!wrap) continue;
      const existingIframe = wrap.querySelector('iframe');
      if (existingIframe) { existingIframe.src = 'about:blank'; existingIframe.style.display = 'none'; }
      wrap.querySelectorAll('video, audio, .short-gv-loading').forEach(el => el.remove());
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'short-gv-loading';
      loadingDiv.innerHTML = '<div class="spinner"></div><span style="color:#fff;">読み込み中...</span>';
      wrap.appendChild(loadingDiv);
    }
    for (const v of currentShortItems) {
      const wrap = document.getElementById(`short-wrap-${v.id}`);
      if (!wrap) continue;
      (async () => {
        const loadingEl = wrap.querySelector('.short-gv-loading');
        // manifestHunt使用
        const huntResult = await manifestHunt(v.id);
        let videoUrl = null, audioUrl = null, isManifest = false, manifestUrl = null;
        if (huntResult) {
          if (huntResult.type === 'manifest' && huntResult.streams.length > 0) {
            manifestUrl = huntResult.streams[0].url;
            isManifest = true;
          } else if (huntResult.type === 'formats' && huntResult.streams.length > 0) {
            const { mp4Pairs } = parseSiawaseokFormats(huntResult.streams);
            const m4aFormats = huntResult.streams.filter(f => (f.ext==='m4a'||f.acodec==='mp4a.40.2') && f.url && (!f.vcodec||f.vcodec==='none'));
            const target = mp4Pairs.find(p => p.label==='360p') || mp4Pairs.find(p => p.label==='480p') || mp4Pairs.find(p => p.label==='720p') || mp4Pairs[0];
            if (target) { videoUrl = target.videoFmt.url; audioUrl = target.audioFmt ? target.audioFmt.url : null; }
          }
        }
        if (!videoUrl && !isManifest) {
          const invFormats = await fetchGoogleVideoStreamsInvidious(v.id);
          if (invFormats) {
            const result = buildGoogleVideoPlayer(invFormats);
            if (result && result.type === 'dual') { videoUrl = result.videoUrl; audioUrl = result.audioUrl; }
            else if (result && result.type === 'single') videoUrl = result.url;
          }
        }
        if (loadingEl) loadingEl.remove();
        const iframe = wrap.querySelector('iframe');
        if (isManifest && manifestUrl) {
          if (iframe) iframe.style.display = 'none';
          const vid = document.createElement('video');
          vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
          vid.autoplay = true; vid.loop = true; vid.playsInline = true;
          wrap.appendChild(vid);
          if (typeof Hls !== 'undefined' && Hls.isSupported() && (manifestUrl.includes('.m3u8') || manifestUrl.includes('hls'))) {
            const hls = new Hls(); hls.loadSource(manifestUrl); hls.attachMedia(vid);
            hls.on(Hls.Events.MANIFEST_PARSED, () => { vid.play().catch(() => {}); });
            hls.on(Hls.Events.ERROR, () => { vid.remove(); if (iframe) { iframe.style.display=''; iframe.src=buildShortNocookieSrc(v.id); } });
          } else {
            vid.src = manifestUrl; vid.play().catch(() => {});
            vid.onerror = () => { vid.remove(); if (iframe) { iframe.style.display=''; iframe.src=buildShortNocookieSrc(v.id); } };
          }
        } else if (videoUrl) {
          if (iframe) iframe.style.display = 'none';
          const vid = document.createElement('video');
          vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
          vid.autoplay = true; vid.loop = true; vid.muted = !audioUrl; vid.playsInline = true; vid.crossOrigin = 'anonymous';
          vid.innerHTML = `<source src="${videoUrl}" type="video/mp4">`;
          wrap.appendChild(vid);
          if (audioUrl) {
            const aud = document.createElement('audio'); aud.style.display='none'; aud.loop=true; aud.crossOrigin='anonymous';
            aud.innerHTML=`<source src="${audioUrl}" type="audio/mp4">`; wrap.appendChild(aud); attachAudioVideoSync(vid, aud);
          }
          vid.play().catch(() => { vid.muted = true; vid.play(); });
        } else {
          if (iframe) { iframe.style.display=''; iframe.src=buildShortNocookieSrc(v.id); }
        }
      })();
    }
  }
}
