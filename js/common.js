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

  // GAS との通信。電波が悪いと応答が返らないまま待ち続けることがあるので、timeout ミリ秒で打ち切る
  async function request(options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(config.GAS_URL, { ...options, signal: controller.signal });
    } catch (e) {
      throw new Error(e.name === 'AbortError'
        ? '通信に時間がかかりすぎたため中断しました。電波の良い場所でもう一度お試しください。'
        : '通信できませんでした。インターネットにつながっているか確認して、もう一度お試しください。');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`通信に失敗しました（${response.status}）。もう一度お試しください。`);
    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error('サーバーから正しい応答がありませんでした。もう一度お試しください。');
    }
    if (!data.ok) throw new Error(data.error);
    return data;
  }

  // GAS から表示中の店とおすすめ数を取得する
  function fetchData() {
    return request({}, 30000);
  }

  // GAS に操作を送る。text/plain で送るのは、ブラウザの事前確認通信（GASが受け付けない）を避けるため。
  // 写真つきは送る量が多いので長めに待つ
  function post(body) {
    return request({
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }, body.photo || (body.changes && body.changes.photo) ? 90000 : 30000);
  }

  // Google ドライブに保存した写真の表示用URL（公式に保証された形式ではないので、表示できないときは代わりのURLを試す）
  function photoUrl(fileId, width) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
  }

  function photoImg(fileId, width, alt) {
    const img = document.createElement('img');
    img.alt = alt;
    img.loading = 'lazy';
    img.src = photoUrl(fileId, width);
    img.addEventListener('error', () => {
      if (img.dataset.fallback) return;
      img.dataset.fallback = '1';
      img.src = `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w${width}`;
    });
    return img;
  }

  function shopIcon(shop) {
    return L.divIcon({
      className: 'shop-marker',
      html: `<span class="shop-marker-emoji">${GENRE_ICONS[shop.genre] || GENRE_ICONS['その他']}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  // 地図の土台（OSMタイル、帰属表示、対象範囲の点線円）
  function createMap(elementId, options) {
    const map = L.map(elementId, { zoomSnap: 0.25, ...options });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    config.AREAS.forEach((area) => {
      L.circle([area.lat, area.lng], {
        radius: area.radius,
        color: '#e8590c',
        weight: 2,
        dashArray: '4 6',
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
    createMap,
    areaBounds,
  };
})();
