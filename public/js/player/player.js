// =================== MANIFEST HUNTER (1つ目のHTMLを参考に実装) ===================
// データの全階層からmanifest.を抽出する再帰関数
function deepSearch(obj) {
  let found = [];
  if (!obj || typeof obj !== 'object') return found;
  if (obj.url && String(obj.url).includes('manifest.')) {
    const type = String(obj.type || obj.mimeType || '');
    if (!type.includes('audio') || type.includes('video')) found.push(obj);
  }
  for (let k in obj) found = found.concat(deepSearch(obj[k]));
  return found;
}
// Stream 再生ソース: choco-inv-stream-api を最優先 → 旧 yt-dlp 互換
const STREAM_SOURCES = [
  vid => `https://choco-inv-stream-api.onrender.com/api/stream/${vid}`,
  vid => `https://choco-inv-stream-api-rcvk.onrender.com/api/stream/${vid}`,
  vid => `https://choco-inv-stream-api-arck.onrender.com/api/stream/${vid}`,
];
const STREAM_PROXIES = [
  '',
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?'
];
// 同一オリジンの動画プロキシ経由にして CORS / 403(IPバインド) を回避
function toVProxy(u) {
  if (!u) return u;
  if (u.startsWith('/api/public/vproxy')) return u;
  return '/api/public/vproxy?url=' + encodeURIComponent(u);
}
async function tryParseStream(res) {
  if (!res.ok) return null;
  const data = await res.json();
  // === aquapp 形式: { formats: [{url, ext, vcodec, acodec, height, format_note, quality, ...}] } / { url, formats } ===
  try {
    const aquaFormats = (data && (data.formats || (data.data && data.data.formats))) || null;
    if (Array.isArray(aquaFormats) && aquaFormats.length && aquaFormats[0] && aquaFormats[0].url && (aquaFormats[0].ext || aquaFormats[0].vcodec || aquaFormats[0].format_note)) {
      const norm = aquaFormats.filter(f => f && f.url).map(f => {
        const vcodec = String(f.vcodec || '').toLowerCase();
        const acodec = String(f.acodec || '').toLowerCase();
        const isAudio = (vcodec === 'none' || vcodec === '') && acodec && acodec !== 'none';
        const height = Number(f.height || 0) || (String(f.format_note||'').match(/(\d+)p/) ? parseInt(String(f.format_note).match(/(\d+)p/)[1]) : 0);
        const isMuxed = !isAudio && acodec && acodec !== 'none' && vcodec && vcodec !== 'none';
        return {
          url: toVProxy(f.url),
          ext: f.ext || (isAudio ? 'm4a' : 'mp4'),
          container: f.ext || (isAudio ? 'm4a' : 'mp4'),
          vcodec: isAudio ? 'none' : (vcodec || 'avc1'),
          acodec: isAudio ? (acodec || 'mp4a.40.2') : (isMuxed ? (acodec || 'mp4a.40.2') : 'none'),
          height,
          qualityLabel: f.format_note || f.quality || (height ? height+'p' : ''),
          format_note: f.format_note || f.quality || '',
          itag: f.format_id || f.itag,
          _muxed: isMuxed
        };
      });
      if (norm.length) { console.log('[ytdlp] aquapp ストリーム解析:', norm.length, '本'); return { type: 'formats', streams: norm }; }
    }
  } catch(e) { console.warn('[ytdlp] aquapp parse error', e); }
  // === nkys-yt-dlp 形式: { streams: [{url, kind:"muxed"|"video"|"audio", type, mime, itag, container, quality}] } ===
  const rawStreams = Array.isArray(data) ? data
    : Array.isArray(data.streams) ? data.streams : null;
  if (!rawStreams) return null;
  const norm = rawStreams.filter(s => s && s.url).map(s => {
    const kind = String(s.kind || s.type || '').toLowerCase();
    const mime = String(s.mime || s.mimeType || '').toLowerCase();
    const itag = s.itag;
    const isAudio = kind === 'audio' || (mime.includes('audio') && !mime.includes('video'));
    const isMuxed = kind === 'muxed' || (!isAudio && mime.includes('video') && (itag == 18 || itag == 22));
    const heightMatch = String(s.quality || '').match(/(\d+)p/);
    const height = heightMatch ? parseInt(heightMatch[1]) : 0;
    return {
      url: toVProxy(s.url),
      ext: s.container || (isAudio ? 'm4a' : 'mp4'),
      container: s.container || (isAudio ? 'm4a' : 'mp4'),
      vcodec: isAudio ? 'none' : 'avc1',
      acodec: isAudio ? 'mp4a.40.2' : (isMuxed ? 'mp4a.40.2' : 'none'),
      height,
      qualityLabel: s.quality || (height ? `${height}p` : (isMuxed ? '360p' : '')),
      format_note: s.quality || '',
      itag,
      _muxed: isMuxed
    };
  });
  if (norm.length === 0) return null;
  console.log('[ytdlp] nkys-yt-dlp ストリーム解析:', norm.length, '本');
  return { type: 'formats', streams: norm };
}
async function fetchStreamSource(apiBase) {
  // プロキシ候補を並列で叩き、最速の成功を返す
  const attempts = STREAM_PROXIES.map(proxy => {
    const targetUrl = proxy ? proxy + encodeURIComponent(apiBase) : apiBase;
    return fetch(targetUrl, { signal: AbortSignal.timeout(12000) })
      .then(tryParseStream)
      .then(r => {
        if (!r) throw new Error('parse failed');
        return r;
      })
      .catch(e => { throw e; });
  });
  try {
    return await Promise.any(attempts);
  } catch(e) {
    console.warn('[StreamHunter] all proxies failed:', apiBase);
    return null;
  }
}
// 自前サーバーと公開CORSプロキシを「並列」で同時に叩き、最速の成功を採用
async function manifestHunt(videoId) {
  const tasks = [];
  // 1. 同一オリジンのサーバープロキシ
  tasks.push(
    fetch(`/api/public/ytdlp/${encodeURIComponent(videoId)}`, { signal: AbortSignal.timeout(15000) })
      .then(tryParseStream)
      .then(r => { if (!r) throw new Error('own server empty'); console.log('[ytdlp] via own server'); return r; })
  );
  // 2. 公開CORSプロキシ経由でnkysを並列で叩く
  for (const buildUrl of STREAM_SOURCES) {
    const apiBase = buildUrl(videoId);
    tasks.push(
      fetchStreamSource(apiBase).then(result => {
        if (!result) throw new Error('no result: ' + apiBase);
        console.log('[ytdlp] via', apiBase);
        return result;
      })
    );
  }
  try { return await Promise.any(tasks); }
  catch (e) { console.warn('[ytdlp] all sources failed', e); return null; }
}
// =================== ytdlp プリフェッチキャッシュ ===================
const _ytdlpCache = new Map();
const _ytdlpPending = new Map();
const _YTDLP_TTL = 5 * 60 * 1000;
function prefetchYtdlp(videoId) {
  if (!videoId) return null;
  const c = _ytdlpCache.get(videoId);
  if (c && (Date.now()-c.ts) < _YTDLP_TTL) return Promise.resolve(c.result);
  if (_ytdlpPending.has(videoId)) return _ytdlpPending.get(videoId);
  const pr = manifestHunt(videoId).then(r => {
    if (r) _ytdlpCache.set(videoId, {result:r, ts:Date.now()});
    _ytdlpPending.delete(videoId);
    return r;
  }).catch(e => { _ytdlpPending.delete(videoId); return null; });
  _ytdlpPending.set(videoId, pr);
  return pr;
}
function getCachedYtdlp(videoId) {
  const c = _ytdlpCache.get(videoId);
  if (c && (Date.now()-c.ts) < _YTDLP_TTL) return c.result;
  return null;
}
// =================== siawaseok API (manifestHuntを内部利用) ===================
async function fetchGVStreamsFromSiawaseok(videoId) {
  const result = await manifestHunt(videoId);
  if (!result) return null;
  if (result.type === 'manifest' || result.type === 'formats') return result.streams;
  if (result.type === 'single') return result.streams;
  return null;
}
function parseSiawaseokFormats(formats) {
  if (!formats) return { mp4Pairs: [], manifestList: [] };
  // ★ "muxed" を最優先で取得（音声付き単一ファイル）
  const muxedFormats = formats.filter(f => f._muxed && f.url);
  const mp4Formats = formats.filter(f => (f.ext === 'mp4' || f.container === 'mp4') && f.url && f.vcodec && f.vcodec !== 'none' && f.acodec === 'none');
  const m4aFormats = formats.filter(f => (f.ext === 'm4a' || f.acodec === 'mp4a.40.2') && f.url && (!f.vcodec || f.vcodec === 'none'));
  const combinedMp4 = formats.filter(f => !f._muxed && (f.ext === 'mp4') && f.url && f.acodec && f.acodec !== 'none' && f.vcodec && f.vcodec !== 'none');
  const manifestList = formats.filter(f => f.url && String(f.url).includes('manifest.'));
  const mp4Pairs = [];
  // muxed を最初に追加（音声付きで即再生可能）
  muxedFormats.forEach(f => {
    const lbl = getLabelFromFmt(f);
    if (!mp4Pairs.find(p => p.label === lbl)) mp4Pairs.push({ videoFmt: f, audioFmt: null, resolution: getResolutionStr(f), label: lbl, isCombined: true, isMuxed: true });
  });
  mp4Formats.forEach(vf => {
    const res = getResolutionStr(vf);
    const af = m4aFormats.find(a => true) || null;
    const lbl = getLabelFromFmt(vf);
    if (!mp4Pairs.find(p => p.label === lbl)) mp4Pairs.push({ videoFmt: vf, audioFmt: af, resolution: res, label: lbl });
  });
  combinedMp4.forEach(f => {
    const lbl = getLabelFromFmt(f);
    if (!mp4Pairs.find(p => p.label === lbl)) mp4Pairs.push({ videoFmt: f, audioFmt: null, resolution: getResolutionStr(f), label: lbl, isCombined: true });
  });
  // muxedを最優先、その後 解像度順
  const order = ['1440p','1080p','720p','480p','360p','240p','144p'];
  mp4Pairs.sort((a, b) => {
    if (a.isMuxed && !b.isMuxed) return -1;
    if (!a.isMuxed && b.isMuxed) return 1;
    const ia = order.indexOf(a.label), ib = order.indexOf(b.label);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return { mp4Pairs, manifestList };
}
function getResolutionStr(fmt) {
  if (fmt.resolution) return fmt.resolution;
  if (fmt.width && fmt.height) return `${fmt.width}x${fmt.height}`;
  if (fmt.height) return `?x${fmt.height}`;
  return '';
}
function getLabelFromFmt(fmt) {
  const note = (fmt.note || fmt.format_note || fmt.resolution || '').toString();
  const h = fmt.height ? `${fmt.height}p` : '';
  const priority = ['2160p','1440p','1080p','720p','480p','360p','240p','144p'];
  for (const p of priority) { if (note.includes(p.replace('p','')) || h === p) return p; }
  return h || note.substring(0, 10) || 'unknown';
}
async function renderSiawaseokPlayer(formats, qualityLabel) {
  const wrapper = document.getElementById('player-wrapper');
  const { mp4Pairs, manifestList } = parseSiawaseokFormats(formats);
  // manifestリストが存在する場合はそちらを優先(Manifest Hunter成果物)
  if (mp4Pairs.length === 0 && manifestList.length > 0) {
    const mf = manifestList[0];
    await renderManifestPlayer(mf.url, getLabelFromFmt(mf) || 'Manifest');
    return;
  }
  if (mp4Pairs.length === 0) {
    wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#000;color:#aaa;flex-direction:column;gap:8px;font-size:13px;"><span>再生できるフォーマットがありません</span><button onclick="switchStream(1)" style="padding:8px 16px;border-radius:20px;background:#fff;color:#000;font-weight:bold;cursor:pointer;border:none;">Nocookieで再生</button></div>`;
    return;
  }
  const defaultLabels = ['360p','480p','720p'];
  let target = mp4Pairs.find(p => p.label === qualityLabel);
  if (!target) { for (const dl of defaultLabels) { target = mp4Pairs.find(p => p.label === dl); if (target) break; } }
  if (!target) target = mp4Pairs[0];
  selectedQuality = target.label;
  document.getElementById('quality-label').textContent = selectedQuality;
  document.querySelectorAll('.quality-option').forEach(el => el.classList.toggle('active', el.dataset.q === selectedQuality));
  const videoUrl = target.videoFmt.url;
  const audioUrl = target.audioFmt ? target.audioFmt.url : null;
  if (target.isCombined || !audioUrl) {
    wrapper.innerHTML = `<video id="gv-video" style="width:100%;height:100%;background:#000;" controls autoplay playsinline preload="auto"><source src="${videoUrl}" type="video/mp4"></video>`;
    document.getElementById('gv-video').onerror = () => { wrapper.innerHTML = failBlock(); };
  } else {
    wrapper.innerHTML = `<video id="gv-video" style="width:100%;height:100%;background:#000;" controls autoplay playsinline preload="auto"><source src="${videoUrl}" type="video/mp4"></video><audio id="gv-audio" style="display:none;"><source src="${audioUrl}" type="audio/mp4"></audio>`;
    const vid = document.getElementById('gv-video'), aud = document.getElementById('gv-audio');
    attachAudioVideoSync(vid, aud);
    vid.onerror = () => { wrapper.innerHTML = failBlock(); };
  }
}
// manifest URL直接再生 (HLS/MPDなど)
async function renderManifestPlayer(manifestUrl, label) {
  const wrapper = document.getElementById('player-wrapper');
  selectedQuality = label;
  const ql = document.getElementById('quality-label'); if (ql) ql.textContent = label;
  wrapper.innerHTML = `<video id="gv-video" style="width:100%;height:100%;background:#000;" controls autoplay></video>`;
  const vid = document.getElementById('gv-video');
  if (manifestUrl.includes('.m3u8') || manifestUrl.includes('hls')) {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(manifestUrl); hls.attachMedia(vid);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { vid.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (event, data) => { if (data.fatal) wrapper.innerHTML = failBlock(); });
    } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
      vid.src = manifestUrl; vid.play().catch(() => {});
    } else {
      wrapper.innerHTML = failBlock();
    }
  } else if (manifestUrl.includes('.mpd') || manifestUrl.includes('manifest/dash') || manifestUrl.includes('manifest.googlevideo')) {
    // DASH (manifest.googlevideo.com 等) は dash.js で再生
    if (typeof dashjs !== 'undefined') {
      try {
        const player = dashjs.MediaPlayer().create();
        player.initialize(vid, manifestUrl, true);
        player.on('error', () => { wrapper.innerHTML = failBlock(); });
      } catch(e) { wrapper.innerHTML = failBlock(); }
    } else {
      vid.src = manifestUrl; vid.play().catch(() => {});
      vid.onerror = () => { wrapper.innerHTML = failBlock(); };
    }
  } else {
    vid.src = manifestUrl;
    vid.play().catch(() => {});
    vid.onerror = () => { wrapper.innerHTML = failBlock(); };
  }
}
function failBlock() { return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#000;color:#aaa;flex-direction:column;gap:8px;font-size:13px;"><span>再生に失敗しました</span><button onclick="switchStream(1)" style="padding:8px 16px;border-radius:20px;background:#fff;color:#000;font-weight:bold;cursor:pointer;border:none;">Nocookieで再生</button></div>`; }
function buildSiawaseokQualityPanel(formats) {
  const panel = document.getElementById('quality-panel'), wrap = document.getElementById('quality-wrap');
  const { mp4Pairs, manifestList } = parseSiawaseokFormats(formats);
  // manifestのみの場合
  if (mp4Pairs.length === 0 && manifestList.length > 0) {
    wrap.style.display = 'flex';
    const defaultOpt = manifestList[0];
    selectedQuality = getLabelFromFmt(defaultOpt) || 'Manifest';
    document.getElementById('quality-label').textContent = '🎯 ' + selectedQuality;
    panel.innerHTML = '<div class="quality-panel-title">📡 Manifest ストリーム</div>' +
      manifestList.map(f => {
        const lbl = getLabelFromFmt(f) || 'Manifest';
        return `<div class="quality-option" data-q="${lbl}" onclick="selectManifestQuality('${encodeURIComponent(f.url)}','${lbl}')">
          🎯 ${lbl}
        </div>`;
      }).join('');
    return;
  }
  if (mp4Pairs.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  const defaultLabels = ['360p','480p','720p'];
  let defaultOpt = null;
  for (const dl of defaultLabels) { defaultOpt = mp4Pairs.find(p => p.label === dl); if (defaultOpt) break; }
  if (!defaultOpt) defaultOpt = mp4Pairs[0];
  selectedQuality = defaultOpt.label;
  document.getElementById('quality-label').textContent = selectedQuality;
  const hdLabels = ['1080p','720p','1440p','2160p'];
  panel.innerHTML = '<div class="quality-panel-title">画質を選択（MP4+M4A）</div>' +
    mp4Pairs.map(o => {
      const isHd = hdLabels.includes(o.label), hasAudio = o.audioFmt || o.isCombined;
      return `<div class="quality-option ${o.label === selectedQuality ? 'active' : ''}" data-q="${o.label}" onclick="selectSiawaseokQuality('${o.label}')">
        ${o.label}
        ${isHd ? '<span class="q-badge">HD</span>' : ''}
        ${hasAudio ? '<span style="font-size:10px;color:#4caf50;margin-left:4px;">🔊</span>' : ''}
      </div>`;
    }).join('') +
    (manifestList.length > 0 ? '<div class="quality-panel-title" style="margin-top:8px;">📡 Manifest</div>' +
      manifestList.map(f => {
        const lbl = getLabelFromFmt(f) || 'Manifest';
        return `<div class="quality-option" data-q="m_${lbl}" onclick="selectManifestQuality('${encodeURIComponent(f.url)}','${lbl}')">🎯 ${lbl}</div>`;
      }).join('') : '');
}
async function selectManifestQuality(encodedUrl, label) {
  const url = decodeURIComponent(encodedUrl);
  selectedQuality = label;
  document.getElementById('quality-label').textContent = '🎯 ' + label;
  document.getElementById('quality-panel').classList.remove('open');
  await renderManifestPlayer(url, label);
}
async function selectSiawaseokQuality(label) {
  if (!currentGVAllFormats) return;
  selectedQuality = label;
  document.getElementById('quality-label').textContent = label;
  document.getElementById('quality-panel').classList.remove('open');
  await renderSiawaseokPlayer(currentGVAllFormats, label);
}
// =================== Stream 再生: choco-inv-stream-api → Invidious フォールバック ===================
async function fetchChocoStreamData(videoId) {
  const urls = STREAM_SOURCES.map(b => b(videoId));
  const controller = new AbortController();
  const tasks = urls.map(async u => {
    const res = await fetch(u, { signal: controller.signal });
    if (!res.ok) throw new Error('bad');
    const d = await res.json();
    const formats = [...(d.adaptiveFormats||[]), ...(d.formatStreams||[])];
    if (!formats.length) throw new Error('empty');
    return { formats, captions: d.captions || [] };
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
  try {
    const r = await Promise.race([Promise.any(tasks), timeout]);
    controller.abort();
    return r;
  } catch(e) { controller.abort(); return null; }
}
async function fetchInvStreamData(videoId) {
  const pool = Array.from(new Set([
    'https://choco-inv-main-api.onrender.com',
    'https://choco-inv-main-api-sexg.onrender.com',
    'https://choco-inv-main-api-ev9d.onrender.com',
    'https://invidious.f5.si','https://yt.omada.cafe',
    ...(getInvidiousFor && getInvidiousFor('video') || []),
    ...INVIDIOUS_INSTANCES.slice(0, 40)
  ]));
  const controller = new AbortController();
  // CORS回避: 各instanceを直接 + 複数プロキシ経由で同時並列発射
  const proxies = (typeof window !== 'undefined' && window.__CORS_PROXIES) ? window.__CORS_PROXIES : [];
  const mkTask = (url) => fetch(url, { signal: controller.signal }).then(r => {
    if (!r.ok) throw new Error('bad');
    return r.json();
  }).then(d => {
    const formats = [...(d.adaptiveFormats||[]), ...(d.formatStreams||[])];
    if (!formats.length) throw new Error('empty');
    return { formats, captions: d.captions || [] };
  });
  const tasks = [];
  for (const inst of pool) {
    const direct = `${inst}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams,captions`;
    tasks.push(mkTask(direct));
    for (const px of proxies) {
      try { tasks.push(mkTask(px(direct))); } catch(_){}
    }
  }
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
  try {
    const r = await Promise.race([Promise.any(tasks), timeout]);
    controller.abort();
    return r;
  } catch(e) { controller.abort(); return null; }
}
let _currentCaptions = [];
let _currentCaptionBase = '';
async function setupWatchManifest(videoId) {
  const wrapper = document.getElementById('player-wrapper');
  wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#000;color:#fff;flex-direction:column;gap:12px;">
    <div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
    <div style="font-size:13px;color:#fff;">Stream 読み込み中...</div>
  </div>___STYLE_PLACEHOLDER___`;
  // 1) choco-inv-stream-api を並列で叩く
  let data = await fetchChocoStreamData(videoId);
  let captionBase = '';
  // 2) ダメなら Invidious フォールバック
  if (!data || !data.formats || !data.formats.length) {
    data = await fetchInvStreamData(videoId);
    // Invidious 経由のキャプションは相対 URL なので base を覚える
    if (data && data.captions) {
      captionBase = (data.captions[0] && data.captions[0]._base) || 'https://invidious.f5.si';
    }
  }
  if (!data || !data.formats || !data.formats.length) {
    wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#000;color:#aaa;flex-direction:column;gap:8px;font-size:13px;"><span>ストリームの取得に失敗しました</span><button onclick="switchStream(1)" style="padding:8px 16px;border-radius:20px;background:#fff;color:#000;font-weight:bold;cursor:pointer;border:none;">Nocookieで再生</button></div>`;
    return;
  }
  _currentCaptions = data.captions || [];
  _currentCaptionBase = captionBase;
  currentGVFormats = data.formats; currentGVAllFormats = null;
  buildInvidiousQualityPanel(data.formats);
  buildDownloadPanel(data.formats, 'watch');
  const opts = getInvidiousQualityOptions(data.formats);
  const defaultQ = opts.find(o => o.label === '360p') || opts.find(o => o.label === '480p') || opts.find(o => o.label === '720p') || opts[0];
  selectedQuality = defaultQ ? defaultQ.label : null;
  if (selectedQuality && document.getElementById('quality-label')) document.getElementById('quality-label').textContent = selectedQuality;
  await renderStreamPlayer(data.formats, selectedQuality, _currentCaptions, _currentCaptionBase);
}
// Stream モード専用プレイヤー: ダブルタップ ±5秒スキップ + 字幕
async function renderStreamPlayer(formats, quality, captions, captionBase) {
  const wrapper = document.getElementById('player-wrapper');
  const result = buildGoogleVideoPlayer(formats, quality);
  if (!result) { wrapper.innerHTML = failBlock(); return; }
  // 字幕 <track> 要素を生成
  let tracksHtml = '';
  if (Array.isArray(captions) && captions.length) {
    tracksHtml = captions.map((c, i) => {
      let url = c.url || '';
      if (url && url.startsWith('/')) url = (captionBase || '') + url;
      // Invidious キャプションは srv3/ttml が多いので fmt=vtt を付与
      if (url && url.indexOf('fmt=') === -1) url += (url.indexOf('?') === -1 ? '?' : '&') + 'fmt=vtt';
      const lang = c.language_code || c.languageCode || c.label || ('cap'+i);
      const label = c.label || lang;
      const def = (lang.indexOf('ja') === 0 && i === 0) ? 'default' : '';
      return `<track kind="subtitles" src="${url}" srclang="${lang}" label="${label}" ${def}>`;
    }).join('');
  }
  if (result.type === 'dual') {
    wrapper.innerHTML = `<div class="stream-player-shell" style="position:relative;width:100%;height:100%;">
      <video id="gv-video" crossorigin="anonymous" style="width:100%;height:100%;background:#000;" controls autoplay playsinline preload="auto">
        <source src="${result.videoUrl}" type="video/mp4">${tracksHtml}
      </video>
      <audio id="gv-audio" style="display:none;"><source src="${result.audioUrl}" type="audio/mp4"></audio>
      <div class="stream-dtap-left" style="position:absolute;left:0;top:0;width:50%;height:100%;z-index:5;"></div>
      <div class="stream-dtap-right" style="position:absolute;right:0;top:0;width:50%;height:100%;z-index:5;"></div>
      <div id="stream-skip-fb" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font-size:22px;font-weight:bold;background:rgba(0,0,0,0.6);padding:10px 20px;border-radius:30px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:10;"></div>
    </div>`;
    attachAudioVideoSync(document.getElementById('gv-video'), document.getElementById('gv-audio'));
  } else {
    wrapper.innerHTML = `<div class="stream-player-shell" style="position:relative;width:100%;height:100%;">
      <video id="gv-video" crossorigin="anonymous" style="width:100%;height:100%;background:#000;" controls autoplay playsinline preload="auto">
        <source src="${result.url}">${tracksHtml}
      </video>
      <div class="stream-dtap-left" style="position:absolute;left:0;top:0;width:50%;height:100%;z-index:5;"></div>
      <div class="stream-dtap-right" style="position:absolute;right:0;top:0;width:50%;height:100%;z-index:5;"></div>
      <div id="stream-skip-fb" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font-size:22px;font-weight:bold;background:rgba(0,0,0,0.6);padding:10px 20px;border-radius:30px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:10;"></div>
    </div>`;
  }
  // ダブルタップ / ダブルクリック ±5秒
  const v = document.getElementById('gv-video');
  const fb = document.getElementById('stream-skip-fb');
  function showFb(txt){ if(!fb) return; fb.textContent = txt; fb.style.opacity = '1'; clearTimeout(fb._t); fb._t = setTimeout(()=>{ fb.style.opacity='0'; }, 500); }
  function skip(sec){ if(!v) return; try { v.currentTime = Math.max(0, Math.min((v.duration||1e9), v.currentTime + sec)); } catch(e){} showFb((sec>0?'+':'')+sec+'秒'); }
  const left = wrapper.querySelector('.stream-dtap-left');
  const right = wrapper.querySelector('.stream-dtap-right');
  function bindDbl(el, sec){
    if (!el) return;
    let last = 0;
    el.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); skip(sec); });
    el.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - last < 300) { e.preventDefault(); skip(sec); last = 0; }
      else last = now;
    }, {passive:false});
    // シングルクリックでは再生/一時停止
    el.addEventListener('click', e => {
      // dblclick が走るのを待つ
      clearTimeout(el._sc);
      el._sc = setTimeout(()=>{ if (v) { if (v.paused) v.play(); else v.pause(); } }, 220);
    });
  }
  bindDbl(left, -5);
  bindDbl(right, 5);
  // デフォルト字幕を有効化（ja 優先）
  try {
    setTimeout(() => {
      if (!v || !v.textTracks) return;
      let target = -1;
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i];
        if ((tt.language||'').startsWith('ja')) { target = i; break; }
      }
      for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = (i === target) ? 'showing' : 'disabled';
    }, 300);
  } catch(e){}
}
async function fetchGoogleVideoStreamsInvidious(videoId) {
  // 0.2秒目標: 全インスタンスへ並列発射し、最速で formats を返したものを採用
  const pool = Array.from(new Set([
    'https://invidious.f5.si','https://yt.omada.cafe',
    ...(getInvidiousFor('video')||[]),
    ...INVIDIOUS_INSTANCES.slice(0, 20)
  ]));
  const controller = new AbortController();
  const tasks = pool.map(instance => (async () => {
    const url = buildFetchUrl(`${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams`);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('bad');
    const data = await res.json();
    const formats = [...(data.adaptiveFormats||[]),...(data.formatStreams||[])];
    if (!formats.length) throw new Error('empty');
    return formats;
  })());
  // 6 秒安全網
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000));
  try {
    const formats = await Promise.race([Promise.any(tasks), timeout]);
    controller.abort(); // 残りをキャンセル
    return formats;
  } catch(e) {
    controller.abort();
    return null;
  }
}
function buildInvidiousQualityPanel(formats) {
  const panel = document.getElementById('quality-panel'), wrap = document.getElementById('quality-wrap');
  const opts = getInvidiousQualityOptions(formats);
  if (opts.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  const defaultQ = opts.find(o => o.label === '360p') || opts.find(o => o.label === '480p') || opts.find(o => o.label === '720p') || opts[0];
  selectedQuality = defaultQ.label;
  document.getElementById('quality-label').textContent = selectedQuality;
  const hdLabels = ['1080p','720p','1440p','2160p'];
  panel.innerHTML = '<div class="quality-panel-title">画質を選択</div>' + opts.map(o => `
    <div class="quality-option ${o.label === selectedQuality ? 'active' : ''}" data-q="${o.label}" onclick="selectInvidiousQuality('${o.label}')">
      ${o.label}${hdLabels.includes(o.label) ? '<span class="q-badge">HD</span>' : ''}
    </div>
  `).join('');
}
function getInvidiousQualityOptions(formats) {
  const seen = new Set(), opts = [];
  const priority = ['1440p','1080p','720p','480p','360p','240p','144p'];
  for (const label of priority) {
    const qNum = label.replace('p','');
    const vf = formats.find(f => f.type && f.type.includes('video') && !f.type.includes('audio') && f.qualityLabel && f.qualityLabel.includes(qNum) && f.url);
    const cf = formats.find(f => f.type && f.type.includes('video') && f.type.includes('audio') && f.qualityLabel && f.qualityLabel.includes(qNum) && f.url);
    if ((vf||cf) && !seen.has(label)) { seen.add(label); opts.push({ label, videoFmt: vf, combinedFmt: cf }); }
  }
  return opts;
}
async function selectInvidiousQuality(label) {
  if (!currentGVFormats) return;
  selectedQuality = label;
  document.getElementById('quality-label').textContent = label;
  document.getElementById('quality-panel').classList.remove('open');
  document.querySelectorAll('.quality-option').forEach(o => o.classList.toggle('active', o.dataset.q === label));
  await renderGVPlayerInvidious(currentGVFormats, label);
}
async function renderGVPlayerInvidious(formats, quality) {
  const wrapper = document.getElementById('player-wrapper');
  const result = buildGoogleVideoPlayer(formats, quality);
  if (!result) { wrapper.innerHTML = failBlock(); return; }
  if (result.type === 'dual') {
    wrapper.innerHTML = `<video id="gv-video" style="width:100%;height:100%;" controls autoplay playsinline preload="auto"><source src="${result.videoUrl}" type="video/mp4"></video><audio id="gv-audio" style="display:none;"><source src="${result.audioUrl}" type="audio/mp4"></audio>`;
    attachAudioVideoSync(document.getElementById('gv-video'), document.getElementById('gv-audio'));
  } else {
    wrapper.innerHTML = `<video style="width:100%;height:100%;" controls autoplay playsinline preload="auto"><source src="${result.url}"></video>`;
  }
}
function buildGoogleVideoPlayer(formats, preferQuality = null) {
  const audioFmt = formats.find(f => f.type && f.type.includes('audio') && !f.type.includes('video') && f.url) || formats.find(f => f.encoding && (f.encoding==='opus'||f.encoding==='aac') && f.url);
  let videoFmt = null;
  if (preferQuality) {
    const qNum = preferQuality.replace('p','');
    videoFmt = formats.find(f => f.type && f.type.includes('video') && !f.type.includes('audio') && f.url && f.qualityLabel && f.qualityLabel.includes(qNum));
  }
  if (!videoFmt) videoFmt = formats.find(f => f.type && f.type.includes('video') && !f.type.includes('audio') && f.url && f.qualityLabel && (f.qualityLabel.includes('720')||f.qualityLabel.includes('1080'))) || formats.find(f => f.type && f.type.includes('video') && !f.type.includes('audio') && f.url && f.qualityLabel && f.qualityLabel.includes('480')) || formats.find(f => f.type && f.type.includes('video') && !f.type.includes('audio') && f.url);
  if (videoFmt && audioFmt) return { type: 'dual', videoUrl: videoFmt.url, audioUrl: audioFmt.url, quality: videoFmt.qualityLabel||'HD' };
  let combined = formats.find(f => f.type && f.type.includes('video') && f.type.includes('audio') && f.url && preferQuality && f.qualityLabel && f.qualityLabel.includes(preferQuality.replace('p',''))) || formats.find(f => f.type && f.type.includes('video') && f.type.includes('audio') && f.url) || formats.find(f => f.url && f.qualityLabel);
  if (combined) return { type: 'single', url: combined.url, quality: combined.qualityLabel||'SD' };
  return null;
}
function toggleQualityPanel(e) { e.stopPropagation(); document.getElementById('quality-panel').classList.toggle('open'); }
document.addEventListener('click', () => {
  document.getElementById('quality-panel')?.classList.remove('open');
  document.querySelectorAll('.download-panel').forEach(p => p.classList.remove('open'));
});
// =================== ダウンロード ===================
function buildDownloadPanelFromSiawaseok(formats, panelId) {
  const panel = document.getElementById(`download-panel-${panelId}`);
  if (!panel) return;
  const { mp4Pairs, manifestList } = parseSiawaseokFormats(formats);
  const m4aFormats = formats.filter(f => (f.ext==='m4a'||f.acodec==='mp4a.40.2') && f.url && (!f.vcodec||f.vcodec==='none'));
  let html = '';
  if (manifestList.length > 0) {
    html += '<div style="padding:8px 16px;font-size:12px;color:var(--text-secondary);font-weight:bold;">🎯 Manifest</div>';
    manifestList.slice(0, 3).forEach(f => {
      const lbl = getLabelFromFmt(f) || 'Manifest';
      html += `<div class="download-option" onclick="window.open('${f.url}','_blank')"><svg viewBox="0 0 24 24"><path d="M15 8H9v3H6l6 6 6-6h-3V8zm-9 9h12v2H6v-2z"/></svg><div class="dl-label"><span class="dl-title">Manifest ${lbl}</span><span class="dl-desc">右クリック→リンクを保存</span></div></div>`;
    });
  }
  if (mp4Pairs.length > 0) {
    html += '<div style="padding:8px 16px;font-size:12px;color:var(--text-secondary);font-weight:bold;border-top:1px solid var(--border-color);margin-top:4px;">映像 (MP4)</div>';
    mp4Pairs.slice(0, 5).forEach(o => {
      const url = o.videoFmt.url;
      html += `<div class="download-option" onclick="startDownload('${encodeURIComponent(url)}','${o.label}.mp4','${o.label}')"><svg viewBox="0 0 24 24"><path d="M15 8H9v3H6l6 6 6-6h-3V8zm-9 9h12v2H6v-2z"/></svg><div class="dl-label"><span class="dl-title">${o.label} (MP4)</span><span class="dl-desc">映像のみ</span></div></div>`;
    });
  }
  if (m4aFormats.length > 0) {
    html += '<div style="padding:8px 16px 4px;font-size:12px;color:var(--text-secondary);font-weight:bold;border-top:1px solid var(--border-color);margin-top:4px;">音声 (M4A)</div>';
    m4aFormats.slice(0, 2).forEach((f, i) => {
      html += `<div class="download-option" onclick="startDownload('${encodeURIComponent(f.url)}','audio_${i}.m4a','M4A音声')"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><div class="dl-label"><span class="dl-title">音声 (M4A)</span></div></div>`;
    });
  }
  html += `<div style="padding:8px 16px 4px;font-size:12px;color:var(--text-secondary);font-weight:bold;border-top:1px solid var(--border-color);margin-top:4px;">外部ツール</div><div class="download-option" onclick="openYtdl()"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg><div class="dl-label"><span class="dl-title">cobaltで開く</span><span class="dl-desc">cobalt.tools（高品質DL）</span></div></div>`;
  panel.innerHTML = html;
}
function buildDownloadPanel(formats, panelId) {
  const panel = document.getElementById(`download-panel-${panelId}`);
  if (!panel) return;
  const audioFmt = formats.find(f => f.type && f.type.includes('audio') && !f.type.includes('video') && f.url);
  const videoOpts = getInvidiousQualityOptions(formats);
  let html = '<div style="padding:8px 16px;font-size:12px;color:var(--text-secondary);font-weight:bold;">動画 (MP4)</div>';
  videoOpts.slice(0, 5).forEach(o => {
    const url = (o.combinedFmt||o.videoFmt)?.url;
    if (!url) return;
    html += `<div class="download-option" onclick="startDownload('${encodeURIComponent(url)}','${o.label}.mp4','${o.label}')"><svg viewBox="0 0 24 24"><path d="M15 8H9v3H6l6 6 6-6h-3V8zm-9 9h12v2H6v-2z"/></svg><div class="dl-label"><span class="dl-title">${o.label} (MP4)</span></div></div>`;
  });
  if (audioFmt) html += `<div style="padding:8px 16px 4px;font-size:12px;color:var(--text-secondary);font-weight:bold;border-top:1px solid var(--border-color);margin-top:4px;">音声</div><div class="download-option" onclick="startDownload('${encodeURIComponent(audioFmt.url)}','audio.m4a','M4A')"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><div class="dl-label"><span class="dl-title">音声のみ (M4A)</span></div></div>`;
  html += `<div style="padding:8px 16px 4px;font-size:12px;color:var(--text-secondary);font-weight:bold;border-top:1px solid var(--border-color);margin-top:4px;">外部ツール</div><div class="download-option" onclick="openYtdl()"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg><div class="dl-label"><span class="dl-title">cobaltで開く</span><span class="dl-desc">cobalt.tools</span></div></div>`;
  panel.innerHTML = html;
}
function toggleDownloadPanel(e, panelId) {
  e.stopPropagation();
  const panel = document.getElementById(`download-panel-${panelId}`);
  if (panelId === 'watch' && !currentGVAllFormats && !currentGVFormats) {
    panel.innerHTML = `<div style="padding:8px 16px;font-size:12px;color:var(--text-secondary);">Manifestモードでストリームを取得するか外部ツールをご利用ください</div><div class="download-option" onclick="openYtdl()"><svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg><div class="dl-label"><span class="dl-title">cobaltで開く</span></div></div>`;
  }
  panel.classList.toggle('open');
}
function openYtdl() { window.open(`https://cobalt.tools/?url=https://www.youtube.com/watch?v=${currentVideoId}`, '_blank'); }
async function startDownload(encodedUrl, filename, label) {
  document.querySelectorAll('.download-panel').forEach(p => p.classList.remove('open'));
  const url = decodeURIComponent(encodedUrl);
  showDlToast(`${label}をダウンロード中...`, 0);
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed');
    const total = parseInt(res.headers.get('Content-Length') || '0');
    const reader = res.body.getReader();
    const chunks = []; let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      if (total > 0) updateDlProgress(received / total * 100);
    }
    updateDlProgress(100);
    const blob = new Blob(chunks);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(currentVideoTitle||'video').replace(/[\\/:*?"<>|]/g,'_')}_${filename}`;
    a.click();
    setTimeout(() => hideDlToast(), 2000);
  } catch(e) {
    hideDlToast();
    if (confirm('直接ダウンロードに失敗しました。cobalt.toolsで開きますか？')) openYtdl();
  }
}
function showDlToast(msg, progress) {
  const t = document.getElementById('dl-toast');
  document.getElementById('dl-toast-msg').textContent = msg;
  document.getElementById('dl-toast-fill').style.width = progress + '%';
  t.classList.add('show');
}
function updateDlProgress(p) { document.getElementById('dl-toast-fill').style.width = p + '%'; }
function hideDlToast() { document.getElementById('dl-toast').classList.remove('show'); }
// =================== 共有 ===================
function shareCurrentVideo() {
  if (!currentVideoId) return;
  openSharePanel(`${location.origin}/watch?v=${currentVideoId}`);
}
function openSharePanel(url) {
  document.getElementById('share-url-input').value = url;
  document.getElementById('share-panel').classList.add('open');
}
function closeSharePanel() { document.getElementById('share-panel').classList.remove('open'); }
function copyShareUrl() {
  const input = document.getElementById('share-url-input');
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.querySelector('.share-copy-btn');
    btn.textContent = 'コピー済み！'; btn.style.background = '#4caf50';
    setTimeout(() => { btn.textContent = 'コピー'; btn.style.background = ''; }, 2000);
  }).catch(() => { input.select(); document.execCommand('copy'); });
}
function shareShort(videoId) { openSharePanel(`${location.origin}/shorts/${videoId}`); }
// =================== 音声同期 ===================
function attachAudioVideoSync(gvV, gvA) {
  const syncTime = () => { if (Math.abs(gvA.currentTime - gvV.currentTime) > 0.3) gvA.currentTime = gvV.currentTime; };
  gvV.onplay = () => { gvA.play().catch(()=>{}); syncTime(); };
  gvV.onpause = () => gvA.pause();
  gvV.onwaiting = () => gvA.pause();
  gvV.onplaying = () => { gvA.play().catch(()=>{}); syncTime(); };
  gvV.onseeked = () => { gvA.currentTime = gvV.currentTime; };
  gvV.ontimeupdate = () => { syncTime(); };
  gvV.onratechange = () => { gvA.playbackRate = gvV.playbackRate; };
  gvV.onvolumechange = () => { gvA.volume = gvV.volume; gvA.muted = gvV.muted; };
}
// =================== ショートObserver ===================
const shortSrcMap = {};
let shortObserver = null;
function initShortObserver() {
  if (shortObserver) { shortObserver.disconnect(); shortObserver = null; }
  const sfp = document.getElementById('shorts-full-page');
  if (!sfp) return;
  shortObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const item = entry.target;
      const videoId = item.dataset.id;
      const iframe = item.querySelector('iframe');
      if (!iframe || !videoId) return;
      if (entry.isIntersecting) {
        const savedSrc = shortSrcMap[videoId];
        if (savedSrc && iframe.src !== savedSrc) iframe.src = savedSrc;
      } else {
        if (iframe.src && iframe.src !== 'about:blank' && iframe.src !== '') {
          if (!iframe.src.includes('about:blank')) shortSrcMap[videoId] = iframe.src;
          iframe.src = 'about:blank';
        }
      }
    });
  }, { root: sfp, threshold: 0.5 });
}
function observeShortItem(el) { if (shortObserver) shortObserver.observe(el); }
// =================== おすすめ ===================
function getWatchHistory() { try { return JSON.parse(localStorage.getItem('history') || '[]'); } catch(e) { return []; } }
function getSearchHistory() { try { return JSON.parse(localStorage.getItem('search_history') || '[]'); } catch(e) { return []; } }
function saveSearchHistory(query) { /* override: 検索履歴を保存しない */ }
function _renderRecCard(v, grid) {
  const card = document.createElement('div'); card.className = 'video-card';
  const durStr = formatDuration(v.duration);
  card.onclick = () => playVideo(v.id, v.title, v.channel, v.authorThumb);
  card.innerHTML = `<div class="thumbnail-container"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" loading="lazy" decoding="async">${durStr ? `<span class="duration-badge">${durStr}</span>` : ''}</div><div class="video-info"><div class="channel-avatar" onclick="event.stopPropagation(); openChannel('${v.channel.replace(/'/g,"\\'")}', '${v.authorThumb}')"><img src="${v.authorThumb}" loading="lazy" decoding="async"></div><div class="video-details"><div class="video-title">${v.title}</div><div class="video-meta-channel"><span>${v.channel}</span></div><div class="video-meta">${v.viewCount ? `<span>${formatViews(v.viewCount)}</span>` : ''}${v.published ? `<span>・ ${v.published}</span>` : ''}</div></div></div>`;
  grid.appendChild(card);
}
async function loadRecommendations() {
  const history = getWatchHistory(), searches = getSearchHistory();
  const grid = document.getElementById('home-recommend-grid'), section = document.getElementById('home-recommend');
  if (!grid || !section) return;
  if (history.length < 2 && searches.length < 2) return;
  section.classList.remove('hidden');
  grid.innerHTML = '<div class="loader" style="grid-column:1/-1;">おすすめを生成中...</div>';
  const keywords = [];
  history.slice(0, 5).forEach(v => { const words = v.title.replace(/[【】「」『』\[\]【】]/g,' ').split(/\s+/); words.slice(0,2).forEach(w => { if (w.length > 2) keywords.push(w); }); });
  searches.slice(0, 3).forEach(s => keywords.push(s));
  if (keywords.length === 0) { section.classList.add('hidden'); return; }
  const pick = keywords.sort(() => Math.random() - 0.5).slice(0, 3);
  // 並列取得 + 最初の応答が来た時点で即描画
  const seen = new Set(); const histIds = new Set(history.map(h=>h.id));
  let cleared = false;
  const tasks = pick.map(kw => fetchFromInvidious(kw, 'trend', 1).then(data => {
    if (!data) return;
    const incoming = data.filter(v => v.type==='video' && v.videoId && _isWithinOneYear(v)).slice(0,4);
    if (!cleared) { grid.innerHTML = ''; cleared = true; }
    for (const v of incoming) {
      if (seen.has(v.videoId) || histIds.has(v.videoId)) continue;
      if (grid.children.length >= 8) break;
      seen.add(v.videoId);
      _renderRecCard({ id: v.videoId, title: v.title, channel: v.author, isShort: v.lengthSeconds > 0 && v.lengthSeconds <= 61, authorThumb: v.authorThumbnails ? v.authorThumbnails[0].url : `https://i.pravatar.cc/150?u=${v.author}`, duration: v.lengthSeconds||0, published: v.publishedText||'', viewCount: v.viewCount||0 }, grid);
    }
  }).catch(()=>{}));
  await Promise.all(tasks);
  if (!cleared || grid.children.length === 0) { section.classList.add('hidden'); }
}
