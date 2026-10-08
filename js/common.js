// トップページと管理ページで共通の部品
(function () {
  'use strict';

  const config = window.APP_CONFIG;

  const GENRE_ICONS = {
    'ラーメン': '🍜',
    'カレー': '🍛',
    '和食': '🍱',
    '洋食': '🍝',
    '中華・アジア': '🥟',
    'ファストフード': '🍔',
    'カフェ・甘味': '☕',
    'パン': '🥐',
    'その他': '🍽️',
  };

  // GAS は時々、20秒以上かかったうえで 404 を返すなど一時的に不調になる。やり直すとたいてい1秒ほどで返ってくるので、
  // 何度やり直しても結果が同じになる操作は、20秒で見切りをつけて自動でやり直す（12秒ほどかかって正常に返ることもある）
  const RETRY = { timeout: 20000, delays: [500, 1500] };

  async function request(options, { timeout, retry }) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await requestOnce(options, retry ? RETRY.timeout : timeout);
      } catch (e) {
        if (!retry || !e.retryable || attempt >= RETRY.delays.length) throw e;
        await new Promise((resolve) => setTimeout(resolve, RETRY.delays[attempt]));
      }
    }
  }

  function retryableError(message) {
    const error = new Error(message);
    error.retryable = true;
    return error;
  }

  // 電波が悪いと応答が返らないまま待ち続けることがあるので、timeout ミリ秒で打ち切る
  async function requestOnce(options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(config.GAS_URL, { ...options, signal: controller.signal });
    } catch (e) {
      throw retryableError(e.name === 'AbortError'
        ? 'サーバーの応答がありませんでした。電波の良い場所で、少し時間をおいてもう一度お試しください。'
        : '通信できませんでした。インターネットにつながっているか確認して、もう一度お試しください。');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const message = `通信に失敗しました（${response.status}）。少し時間をおいてもう一度お試しください。`;
      throw response.status === 404 || response.status >= 500 ? retryableError(message) : new Error(message);
    }
    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw retryableError('サーバーから正しい応答がありませんでした。もう一度お試しください。');
    }
    if (!data.ok) {
      // サーバーが内容を確認したうえで断った（パスワード違いなど）。通信の失敗とは区別する
      const error = new Error(data.error);
      error.fromServer = true;
      throw error;
    }
    return data;
  }

  // GAS から表示中の店とおすすめ数を取得する
  function fetchData() {
    return request({}, { retry: true });
  }

  // やり直しても結果が変わらない操作（おすすめは「オン／オフにする」という指定なので二重にならない）
  const SAFE_TO_RETRY = ['recommend', 'adminList'];

  // GAS に操作を送る。text/plain で送るのは、ブラウザの事前確認通信（GASが受け付けない）を避けるため。
  // 店の追加・編集はやり直すと二重になりうるので1回だけ。写真つきは送る量が多いので長めに待つ
  function post(body) {
    const hasPhoto = body.photo || (body.changes && body.changes.photo);
    return request({
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }, { timeout: hasPhoto ? 90000 : 45000, retry: SAFE_TO_RETRY.includes(body.action) });
  }

  // Google ドライブに保存した写真の表示用URL（公式に保証された形式ではないので、表示できないときは代わりのURLを試す）
  function photoUrl(fileId, width) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
  }

  function photoImg(fileId, width, alt, lazy) {
    const img = document.createElement('img');
    img.alt = alt;
    if (lazy) img.loading = 'lazy';
    // どのサイトから読み込んだかを Google に送ると、表示を断られることがあるので送らない
    img.referrerPolicy = 'no-referrer';
    img.src = photoUrl(fileId, width);
    img.addEventListener('error', () => {
      if (img.dataset.fallback) return;
      img.dataset.fallback = '1';
      img.src = `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w${width}`;
    });
    return img;
  }

  // ---- 店のピン ----
  // 見た目のピンより一回り大きい透明な枠を付け、指で押せる範囲を 44px 以上にする
  const PIN_SIZES = {
    normal: { pin: [30, 40], box: [44, 48] },
    recommended: { pin: [36, 48], box: [48, 56] },
    selected: { pin: [44, 58], box: [56, 66] },
  };
  const PIN_PATH = 'M15 0C6.7 0 0 6.7 0 15c0 10.3 15 25 15 25s15-14.7 15-25C30 6.7 23.3 0 15 0z';

  // count: おすすめ数、selected: 詳細パネルで表示中か
  function shopIcon(shop, { count = 0, selected = false } = {}) {
    const kind = selected ? 'selected' : count > 0 ? 'recommended' : 'normal';
    const { pin, box } = PIN_SIZES[kind];
    const emoji = GENRE_ICONS[shop.genre] || GENRE_ICONS['その他'];
    const badge = count > 0 ? `<span class="pin-badge">${count > 99 ? '99+' : count}</span>` : '';
    return L.divIcon({
      className: `shop-pin shop-pin--${kind}` + (selected ? ' is-selected' : ''),
      html: `<span class="pin-body" style="width:${pin[0]}px;height:${pin[1]}px">`
        + `<svg class="pin-shape" viewBox="-2 -2 34 44" aria-hidden="true"><path d="${PIN_PATH}"/></svg>`
        + `<span class="pin-emoji">${emoji}</span>${badge}</span>`,
      iconSize: box,
      iconAnchor: [box[0] / 2, box[1]], // ピンの先端が店の位置
    });
  }

  // まとめ表示の丸（紺色に白い数字）。数が多いほど少し大きく
  function clusterIcon(cluster) {
    const n = cluster.getChildCount();
    const size = n < 10 ? 44 : n < 50 ? 50 : 56;
    return L.divIcon({
      className: 'shop-cluster',
      html: `<span>${n}</span>`,
      iconSize: [size, size],
    });
  }

  // ---- 地図の土台（地図の画像、出典表示、対象範囲の点線円） ----

  const BASEMAP_KEY = 'meshi-basemap';

  function savedBasemap() {
    try { return localStorage.getItem(BASEMAP_KEY); } catch (e) { return null; }
  }

  function basemapLayer(basemap) {
    const layer = L.tileLayer(basemap.url.replace('{key}', encodeURIComponent(config.CARTO_KEY)), {
      maxZoom: 19,
      maxNativeZoom: basemap.maxNativeZoom,
      attribution: basemap.attribution,
    });
    // 色の調整は地図の画像だけにかける（ピンやパネルには影響しない）
    layer.on('add', () => { layer.getContainer().style.filter = basemap.filter || ''; });
    return layer;
  }

  // switcher: true なら右上に地図の切り替えボタンを出す（比較用）
  function createMap(elementId, options, { switcher = false } = {}) {
    const map = L.map(elementId, { zoomSnap: 0.25, ...options });
    const usable = config.BASEMAPS.filter((b) => !b.needsCartoKey || config.CARTO_KEY);
    const layers = Object.fromEntries(usable.map((b) => [b.id, basemapLayer(b)]));
    // 店の位置などのデータは OpenStreetMap 由来なので出典を出す。
    // ただし地図の画像の出典にすでに OpenStreetMap が入っている地図では、二重にならないよう省く
    const dataAttribution = '店舗データ &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    function useBasemap(id) {
      const basemap = usable.find((b) => b.id === id);
      map.attributionControl.removeAttribution(dataAttribution);
      if (!basemap.attribution.includes('openstreetmap.org')) map.attributionControl.addAttribution(dataAttribution);
    }

    const chosen = (switcher && layers[savedBasemap()]) ? savedBasemap() : config.BASEMAP;
    const first = layers[chosen] ? chosen : usable[0].id;
    layers[first].addTo(map);
    useBasemap(first);

    if (switcher) {
      L.control.layers(Object.fromEntries(usable.map((b) => [b.name, layers[b.id]])), null, { collapsed: true }).addTo(map);
      map.on('baselayerchange', (event) => {
        const id = Object.keys(layers).find((key) => layers[key] === event.layer);
        useBasemap(id);
        try { localStorage.setItem(BASEMAP_KEY, id); } catch (e) { /* 保存できなくても切り替えは効く */ }
      });
    }

    config.AREAS.forEach((area) => {
      L.circle([area.lat, area.lng], {
        radius: area.radius,
        color: '#364fc7',
        opacity: 0.55,
        weight: 2,
        dashArray: '6 6',
        fill: false,
        interactive: false,
      }).addTo(map);
    });
    return map;
  }

  function areaBounds() {
    return L.latLngBounds(config.AREAS.map((a) => L.latLng(a.lat, a.lng).toBounds(a.radius * 2)));
  }

  window.Meshi = {
    GENRES: Object.keys(GENRE_ICONS),
    GENRE_ICONS,
    fetchData,
    post,
    photoImg,
    shopIcon,
    clusterIcon,
    createMap,
    areaBounds,
  };
})();
