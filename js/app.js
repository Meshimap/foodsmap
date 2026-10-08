(function () {
  'use strict';

  const config = window.APP_CONFIG;

  // 両エリアがちょうど収まる範囲で地図を開く
  const areaBounds = L.latLngBounds(
    config.AREAS.map((a) => L.latLng(a.lat, a.lng).toBounds(a.radius * 2))
  );

  // zoomSnap を細かくして、スマホ幅でも両エリアがぎりぎり大きく収まるようにする
  const map = L.map('map', { zoomControl: true, zoomSnap: 0.25 });
  map.fitBounds(areaBounds);

  // 読み込み直後は地図の枠の大きさが確定していないことがある（画面回転・PCのウィンドウ変更も同様）。
  // 利用者がまだ地図を触っていなければ、枠の大きさが変わるたびに両エリアが収まるよう合わせ直す
  const mapEl = document.getElementById('map');
  let userInteracted = false;
  ['mousedown', 'touchstart', 'wheel', 'keydown'].forEach((type) => {
    mapEl.addEventListener(type, () => { userInteracted = true; }, { passive: true });
  });
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!userInteracted) map.fitBounds(areaBounds);
  }).observe(mapEl);

  // OSMタイル。帰属表示は利用規約上必須
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // 対象範囲の目安を薄い円で表示
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

  // エリア移動ボタン
  const nav = document.querySelector('.area-buttons');
  config.AREAS.forEach((area) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'area-button';
    button.textContent = area.name;
    button.addEventListener('click', () => {
      userInteracted = true;
      map.flyTo([area.lat, area.lng], config.AREA_ZOOM, { duration: 0.6 });
    });
    nav.appendChild(button);
  });

  // ---- 店のアイコン ----

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

  function shopIcon(shop) {
    return L.divIcon({
      className: 'shop-marker',
      html: `<span class="shop-marker-emoji">${GENRE_ICONS[shop.genre] || GENRE_ICONS['その他']}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  // 密集した店は数字入りの丸にまとめる。拡大すると個々のアイコンに分かれる
  const clusters = L.markerClusterGroup({
    maxClusterRadius: 45,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    chunkedLoading: true,
  });
  map.addLayer(clusters);

  // 仮の表示（ステップ5で画面下から出る詳細パネルに置き換える）。店名は textContent で入れて HTML として解釈させない
  function popupContent(shop) {
    const el = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = shop.name;
    const genre = document.createElement('div');
    genre.textContent = shop.genre;
    el.append(name, genre);
    return el;
  }

  function showMessage(text) {
    const el = document.querySelector('.map-message');
    el.textContent = text;
    el.hidden = false;
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }

  async function loadShops() {
    const [osm, extra] = await Promise.all([
      loadJson(config.SHOPS_URL),
      // 手動追加の店は無くても地図は使えるので、読み込めなくても止めない
      loadJson(config.EXTRA_SHOPS_URL).catch((e) => {
        console.warn('extra_shops.json を読み込めませんでした', e);
        return { shops: [] };
      }),
    ]);
    return [...osm.shops, ...(extra.shops || [])];
  }

  loadShops()
    .then((shops) => {
      clusters.addLayers(shops.map((shop) =>
        L.marker([shop.lat, shop.lng], { icon: shopIcon(shop), title: shop.name })
          .bindPopup(() => popupContent(shop))
      ));
    })
    .catch((e) => {
      console.error(e);
      showMessage('お店のデータを読み込めませんでした。ページを再読み込みしてください。');
    });
})();
