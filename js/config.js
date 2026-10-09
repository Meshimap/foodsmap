// サイトの設定。運営が変更しうる値はここにまとめる。
window.APP_CONFIG = {
  // 対象エリア（駅の位置と、店を集める半径[メートル]）
  AREAS: [
    { id: 'suidobashi', name: '水道橋', lat: 35.7020, lng: 139.7536, radius: 500 },
    { id: 'akihabara',  name: '秋葉原', lat: 35.6984, lng: 139.7731, radius: 500 },
  ],
  // エリアボタンで移動したときのズーム
  AREA_ZOOM: 16,
  // 掲載店・おすすめを保存している Google Apps Script（ウェブアプリ）のURL
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxwNFlRV_RkSCrXbpieCKHsL3SlgbE1VFqPoxW_u880qCRNtw_zbejDTP-9NbU2iAJ7uA/exec',
  // 管理ページで店名検索に使う候補リスト（OSMから取得したもの）
  CANDIDATES_URL: 'data/shops.json',
  // 地図で赤枠で目立たせる建物（日本大学経済学部。scripts/fetch_venue.py で作成）と、そこに付けるラベル
  VENUE_URL: 'data/venue.json',
  VENUE_LABEL: '🏫 日本大学経済学部',

  // ---- 地図の画像（ベースマップ） ----
  // 使う地図。BASEMAPS の id のどれか
  // 2026-10 にスマホで見比べて、彩度を下げた OpenStreetMap に決定
  BASEMAP: 'osm',
  // true にすると、トップページの右上に地図の切り替えボタンを出す（見比べるとき用）
  BASEMAP_SWITCHER: false,
  // CARTO の API キー（無料・メール登録で発行）。空のあいだは CARTO の地図は選べない
  // 地図を OpenStreetMap に決めたので、使わないキーは公開しないよう空にした（2026-10-09）
  CARTO_KEY: '',
  // filter は地図の画像だけにかける色の調整（彩度・明るさを下げてピンを目立たせる）
  BASEMAPS: [
    {
      id: 'gsi_pale',
      name: '国土地理院 淡色地図',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
      maxNativeZoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
      filter: 'brightness(0.93) contrast(1.05)',
    },
    {
      id: 'gsi_std',
      name: '国土地理院 標準地図',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
      maxNativeZoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
      filter: 'saturate(0.55) brightness(0.95)',
    },
    {
      id: 'carto_voyager',
      name: 'CARTO Voyager',
      url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key={key}',
      needsCartoKey: true,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      filter: 'saturate(0.7) brightness(0.95)',
    },
    {
      id: 'carto_positron',
      name: 'CARTO Positron',
      url: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key={key}',
      needsCartoKey: true,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      filter: 'brightness(0.92) contrast(1.05)',
    },
    {
      id: 'osm',
      name: 'OpenStreetMap（今までの地図）',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      filter: 'saturate(0.5) brightness(0.93)',
    },
  ],
};
