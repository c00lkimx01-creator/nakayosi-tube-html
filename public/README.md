# 仲良しTube plus — ファイル構成と役割

## 全体像

```
public/
├── index.html          ← エントリーポイント（HTML骨格 + スクリプト読み込み順の定義）
├── css/                ← スタイルシート（6分割）
├── js/                 ← JavaScript（役割別に4サブフォルダ）
│   ├── core/           ← 起動時に最初に読まれる基盤コード
│   ├── ui/             ← 画面描画・API通信・アプリ本体
│   ├── player/         ← 動画プレイヤー・ショート動画
│   └── patches/        ← 既存関数を上書き拡張するパッチ群
└── instances/          ← APIインスタンスのURLリスト（JSON）
```

---

## index.html（1,356行）

- `<head>` に CSS 6枚・hls.js（CDN defer）を記述
- `<body>` に画面の HTML 骨格（ヘッダー・サイドバー・モーダル・プレイヤーなど）
- `<body>` 末尾で JS ファイルを**順番通り**に `<script src>` で読み込む
  - 読み込み順: `core/` → `ui/` → `player/` → `patches/`

---

## css/（3,567行 合計）

| ファイル | 行数 | 内容 |
|---|---|---|
| `base.css` | 71 | CSS変数（テーマカラー）・リセット・body基本スタイル |
| `layout.css` | 435 | グリッド・フレックスレイアウト・ヘッダー・サイドバー配置 |
| `components.css` | 1,547 | カード・ボタン・モーダル・トースト・フォームなどUI部品 |
| `player.css` | 457 | 動画プレイヤー・コントロールバー・フルスクリーン対応 |
| `pages.css` | 986 | ホーム・検索・チャンネル・設定など各ページ固有スタイル |
| `animations.css` | 71 | フェード・スピナー・スライドなどアニメーション定義 |

---

## js/core/（起動基盤）

### `config.js`（388行）
- `INVIDIOUS_INSTANCES` — フォールバック用インスタンス10件
- `_splitInstances()` — インスタンスを役割別に5分割するユーティリティ
- `INVIDIOUS_ROLES` — trend / search / shorts / channel / video ごとのインスタンス割り当て
- `getInvidiousFor(role)` — 役割からインスタンス一覧を返す関数
- **`enhanceInstancesAndLive()` IIFE** — ページ読み込み後に非同期で以下を実行:
  - `instances/invidious.json` → 260件にマージ（失敗時はリモートAPIにフォールバック）
  - `instances/piped.json` → `window.PIPED_INSTANCES` にマージ
  - `instances/other.json` → `window.OTHER_INSTANCES` に格納
  - `live.json` → ライブ動画IDを `window.LIVE_VIDEO_IDS` に格納
  - sessionStorage に30分キャッシュ

### `settings.js`（288行）
- `getAppConfig()` / `saveAppConfig()` — localStorage を使ったアプリ設定の読み書き
- 設定項目: プロキシON/OFF・ストリーム品質・テーマ・初回訪問フラグ など
- 設定UIの描画・イベント登録

---

## js/ui/（画面とAPI）

### `api.js`（493行）
- `fetchFromInvidious(query, context, page)` — Invidiousへの検索・トレンド取得
  - ラウンド1: 全インスタンスに直接並列リクエスト（`Promise.any`）
  - ラウンド2: 失敗時に CORS プロキシ経由で再レース
- `fetchChannelInfoFromInvidious(name)` — チャンネル情報取得
- `fetchChannelVideos(name, page)` — チャンネル動画一覧取得
- `fetchChannelLiveVideos(name)` — ライブ配信取得
- `_pickBestChannel(list, target)` — 検索結果から最適チャンネルを選ぶロジック

### `render.js`（500行）
- `renderVideoCard(video)` — 動画カードHTML生成
- `renderChannelCard(ch)` — チャンネルカードHTML生成
- `renderVideoGrid(videos, container)` — カードをグリッドに並べて描画
- サムネイル遅延ロード・エラー時プレースホルダー処理

### `app-ui.js`（972行）
- アプリの**メインコントローラー**
- `initApp()` — 起動シーケンス
- `showHome()` / `showSearch()` / `showChannel()` — ページ切り替え
- 検索バー・サイドバー・履歴・ヘッダーのイベントハンドラ
- ダウンロードトースト・シェアパネル・キーボードショートカット

---

## js/player/（プレイヤー）

### `player.js`（775行）
- `playVideo(id, title, channel, thumb)` — 動画再生エントリーポイント
- HLS（hls.js）/ DASH（dash.js 遅延ロード）/ 直接URL の3方式を自動選択
- プレイヤーUI: 再生・一時停止・シーク・音量・全画面・ピクチャーインピクチャー
- 関連動画・概要欄・いいね数の表示
- `buildFetchUrl(url)` — CORSプロキシを挟むかどうかをユーザー設定に応じて切り替え

### `shorts.js`（203行）
- ショート動画専用プレイヤー
- 縦型UI・スワイプ送り・ループ再生
- `fetchChannelShortsMultiPage()` による複数ページ先読み

---

## js/patches/（拡張パッチ — 既存関数を上書き）

> **読み込み順は必ず `ui/` より後**。既存の関数が定義された後でラップ・上書きする設計。

### `patch-core.js`（887行）
- Invidiousインスタンスの**成功率を学習**し `_apiStats` に記録
- `fetchFromInvidious` をラップして成功/失敗をカウント
- Piped APIインスタンスを追加登録
- 設定画面に「API優先度UI」を追加（Piped / Invidious / Min-Pro の順番をD&Dで変更可能）
- ホーム表示時にチャンネル登録済みのものを優先表示するロジック

### `patch-api.js`（665行）
- `PIPED_INSTANCES` の動的読み込みと管理
- Piped API 経由での動画取得・チャンネル情報取得の代替実装
- `window.PIPED_INSTANCES` が空のときのフォールバック（6件）

### `patch-speed.js`（1,158行）
- **並列レース強化版**のAPI関数群を上書き
- `parallelRaceJson(urls, {want, timeout})` — N件の応答が揃ったら返すユーティリティ
- `fetchChannelVideos` / `fetchChannelInfoFromInvidious` / `fetchChannelLiveVideos` / `fetchChannelShortsMultiPage` / 動画詳細取得 を全て並列版に置き換え
- YouTube Data API v3 対応（ユーザーがAPIキーを登録した場合）
- 成功率スコアによる `INVIDIOUS_INSTANCES` の定期ソート（15秒ごと）

### `patch-home.js`（401行）
- ホーム画面の表示ロジックを拡張
- yt-dlp 画質設定の追加
- 自動再生秒数制限の設定追加
- `getAppConfig` に追加設定項目をマージ

### `patch-features.js`（186行）
- 音声検索（Web Speech API）
- その他UI拡張機能（Phase A スクリプト群）

---

## instances/（12KB 合計）

| ファイル | サイズ | 内容 |
|---|---|---|
| `invidious.json` | 8.5KB | Invidiousインスタンス260件のURLリスト（配列） |
| `piped.json` | 2.3KB | Piped APIインスタンス71件のURLリスト（配列） |
| `other.json` | 1.3KB | その他フロントエンド（poketube・hyperpipe・beatbump・youtube_proxy・cors_proxies など）をカテゴリ別にまとめたオブジェクト |

`config.js` の `enhanceInstancesAndLive()` が起動時に非同期でこれらを読み込み、
sessionStorage に30分間キャッシュして再利用する。

---

## JS 読み込み順（index.html 末尾）

```
1. js/core/config.js      ← INVIDIOUS_INSTANCES・getInvidiousFor・enhanceInstancesAndLive
2. js/core/settings.js    ← getAppConfig・saveAppConfig・設定UI
3. js/ui/api.js           ← fetchFromInvidious・fetchChannelInfo など基本API関数
4. js/ui/render.js        ← renderVideoCard・renderVideoGrid など描画関数
5. js/ui/app-ui.js        ← initApp・showHome・showSearch など画面制御
6. js/player/player.js    ← playVideo・HLS/DASH再生・プレイヤーUI
7. js/player/shorts.js    ← ショート動画プレイヤー
8. js/patches/patch-home.js     ← getAppConfig を拡張
9. js/patches/patch-api.js      ← Piped API管理
10. js/patches/patch-core.js    ← 成功率学習・優先度UI
11. js/patches/patch-speed.js   ← 並列レース強化・YouTube API
12. js/patches/patch-features.js ← 音声検索など追加機能
```

---

## データフロー（ホーム表示の例）

```
initApp()
  └─ showHome()
       └─ fetchFromInvidious('', 'trend')   ← api.js（基本実装）
            ↑ patch-core.js がラップして成功率を記録
            ↑ patch-speed.js がラップして並列レース版に差し替え
                 └─ Promise.any([inst1, inst2, ...inst260])
                      └─ 最速のインスタンスが返したデータ
                           └─ renderVideoGrid()  ← render.js
                                └─ 画面に動画カードを描画
```
