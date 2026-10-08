(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const { createMap, areaBounds, shopIcon, clusterIcon, fetchData, post, photoImg, toast, GENRE_ICONS } = window.Meshi;

  // 両エリアがちょうど収まる範囲で地図を開く
  const bounds = areaBounds();
  const map = createMap('map', { zoomControl: true }, { switcher: config.BASEMAP_SWITCHER });
  map.fitBounds(bounds);

  // 読み込み直後は地図の枠の大きさが確定していないことがある（画面回転・PCのウィンドウ変更も同様）。
  // 利用者がまだ地図を触っていなければ、枠の大きさが変わるたびに両エリアが収まるよう合わせ直す
  const mapEl = document.getElementById('map');
  let userInteracted = false;
  ['mousedown', 'touchstart', 'wheel', 'keydown'].forEach((type) => {
    mapEl.addEventListener(type, () => { userInteracted = true; }, { passive: true });
  });
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!userInteracted) map.fitBounds(bounds);
  }).observe(mapEl);

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

  // ---- 日本大学経済学部の建物（赤枠で目立たせる） ----

  fetch(config.VENUE_URL)
    .then((response) => response.json())
    .then((venue) => {
      // クリックは地図に通す（パネルを閉じる操作を邪魔しない）
      const buildings = L.geoJSON(venue, {
        interactive: false,
        style: { color: '#e03131', weight: 3, fillColor: '#e03131', fillOpacity: 0.12 },
      }).addTo(map);
      // ラベルは本館に重ねる（本館が見つからなければ建物全体の中央）
      let main = null;
      buildings.eachLayer((layer) => {
        if (/本館/.test(layer.feature.properties.name)) main = layer;
      });
      L.marker((main || buildings).getBounds().getCenter(), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'venue-label', html: `<span>${config.VENUE_LABEL}</span>`, iconSize: null }),
      }).addTo(map);
    })
    .catch((e) => console.warn('建物の形を読み込めませんでした', e));

  // ---- 店のアイコン ----

  // 密集した店は数字入りの丸にまとめる。拡大すると個々のアイコンに分かれる
  const clusters = L.markerClusterGroup({
    maxClusterRadius: 45,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: clusterIcon,
  });
  map.addLayer(clusters);

  // ---- 詳細パネル ----

  // ---- この端末の情報（ブラウザに保存。使えない環境ではページを開いている間だけ覚える） ----

  const DEVICE_KEY = 'meshi-device-id';
  const RECOMMENDED_KEY = 'meshi-recommended';

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  // 端末ごとのランダムな識別子（1端末1店1回の判定に使う。個人を特定する情報は含まない）
  function deviceId() {
    let id = load(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
      id = window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      save(DEVICE_KEY, id);
    }
    return id;
  }

  function loadRecommended() {
    try { return new Set(JSON.parse(load(RECOMMENDED_KEY) || '[]')); } catch (e) { return new Set(); }
  }

  const state = {
    counts: {},
    recommended: loadRecommended(), // この端末でおすすめした店の ID
    pending: new Set(), // 送信中の店の ID
    current: null,
    markers: new Map(),
  };
  const sheet = document.getElementById('sheet');
  const sheetBody = sheet.querySelector('.sheet-body');

  // 要素を作る小さな道具。文字は textContent で入れて、HTML として解釈させない
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // OSM の営業時間の書き方（例: "Mo-Fr 11:00-21:00; Sa,Su off"）を日本語にする
  const DAYS = { Mo: '月', Tu: '火', We: '水', Th: '木', Fr: '金', Sa: '土', Su: '日', PH: '祝' };
  function formatHours(hours) {
    if (hours.trim() === '24/7') return ['24時間営業'];
    return hours.split(';').map((part) => part.trim()
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d])
      .replace(/\b(off|closed)\b/gi, '休み')
      .replace(/,/g, '・')
      .replace(/-/g, '〜'))
      .filter(Boolean);
  }

  // 一番近いエリア名（Googleマップの検索語に添えて、同名の別の店に飛ばないようにする）
  function nearestAreaName(shop) {
    const here = L.latLng(shop.lat, shop.lng);
    return config.AREAS.reduce((best, a) =>
      (here.distanceTo([a.lat, a.lng]) < here.distanceTo([best.lat, best.lng]) ? a : best)).name;
  }

  function googleMapsUrl(shop) {
    const query = `${shop.name} ${nearestAreaName(shop)}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function renderSheet(shop) {
    const count = state.counts[shop.id] || 0;
    const done = state.recommended.has(shop.id);
    const nodes = [];

    if (shop.photo) {
      const photo = el('div', 'sheet-photo');
      photo.appendChild(photoImg(shop.photo, 800, shop.name));
      nodes.push(photo);
    }

    const title = el('div', 'sheet-title');
    title.append(el('h2', null, shop.name), el('span', 'genre-chip', `${GENRE_ICONS[shop.genre] || ''} ${shop.genre}`));
    nodes.push(title);

    if (shop.comment) {
      const comment = el('div', 'sheet-comment');
      comment.append(el('span', 'sheet-comment-label', '運営のひとこと'), el('p', null, shop.comment));
      nodes.push(comment);
    }

    const rec = el('div', 'recommend');
    rec.appendChild(el('p', 'recommend-count', count > 0 ? `${count}人がおすすめ` : 'まだおすすめはありません'));
    const button = el('button', 'recommend-button' + (done ? ' is-done' : ''), done ? 'おすすめ済み ✓' : 'おすすめ！');
    button.type = 'button';
    button.disabled = state.pending.has(shop.id); // 送信が終わるまで連打できないようにする
    button.setAttribute('aria-pressed', String(done));
    button.addEventListener('click', () => toggleRecommend(shop));
    rec.appendChild(button);
    if (done) rec.appendChild(el('p', 'muted recommend-note', 'もう一度押すと取り消せます'));
    nodes.push(rec);

    const info = el('dl', 'sheet-info');
    if (shop.address) info.append(el('dt', null, '住所'), el('dd', null, shop.address));
    if (shop.hours) {
      const dd = el('dd');
      formatHours(shop.hours).forEach((line) => dd.appendChild(el('div', null, line)));
      dd.appendChild(el('div', 'muted', '※地図データの情報です。変わっている場合があります'));
      info.append(el('dt', null, '営業時間'), dd);
    }
    if (info.childElementCount) nodes.push(info);

    const maps = el('a', 'secondary-button maps-button', 'Googleマップで開く');
    maps.href = googleMapsUrl(shop);
    maps.target = '_blank';
    maps.rel = 'noopener';
    nodes.push(maps);

    sheetBody.replaceChildren(...nodes);
  }

  // ピンの見た目を今の状態（おすすめ数・表示中か）に合わせる
  function refreshMarker(shop) {
    const marker = state.markers.get(shop.id);
    if (!marker) return;
    const selected = state.current === shop;
    marker.setIcon(shopIcon(shop, { count: state.counts[shop.id] || 0, selected }));
    marker.setZIndexOffset(selected ? 1000 : (state.counts[shop.id] || 0) > 0 ? 100 : 0);
  }

  // パネルを開いている間は、地図に .has-selection を付けて他のピンを半透明にする（css/style.css）
  function select(shop) {
    const previous = state.current;
    state.current = shop;
    if (previous) refreshMarker(previous);
    if (shop) refreshMarker(shop);
    mapEl.classList.toggle('has-selection', Boolean(shop));
  }

  function openSheet(shop) {
    select(shop);
    renderSheet(shop);
    refreshCounts();
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
    // 店のアイコンがパネルに隠れないよう、地図の見える部分の中央あたりに寄せる
    const hiddenHeight = window.innerWidth >= 768 ? 0 : sheet.offsetHeight;
    const point = map.latLngToContainerPoint([shop.lat, shop.lng]);
    const target = L.point(map.getSize().x / 2, (map.getSize().y - hiddenHeight) / 2);
    map.panBy(point.subtract(target), { duration: 0.4 });
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    select(null);
  }

  sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);
  map.on('click', closeSheet);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet();
  });

  // ---- おすすめ ----

  function setRecommended(shop, on, count) {
    if (on) state.recommended.add(shop.id); else state.recommended.delete(shop.id);
    save(RECOMMENDED_KEY, JSON.stringify([...state.recommended]));
    state.counts[shop.id] = Math.max(0, count);
    refreshMarker(shop);
    if (state.current === shop) renderSheet(shop);
  }

  // 押した瞬間に数を増やして（減らして）表示し、裏で GAS に送る。失敗したら元に戻す
  async function toggleRecommend(shop) {
    if (state.pending.has(shop.id)) return;
    const on = !state.recommended.has(shop.id);
    const before = state.counts[shop.id] || 0;
    state.pending.add(shop.id);
    setRecommended(shop, on, before + (on ? 1 : -1));
    try {
      const result = await post({ action: 'recommend', shopId: shop.id, deviceId: deviceId(), on });
      state.pending.delete(shop.id);
      setRecommended(shop, result.on, result.count); // 他の人の分も含めた最新の数
      if (on) toast('おすすめしました！');
    } catch (e) {
      state.pending.delete(shop.id);
      setRecommended(shop, !on, before);
      toast(e.message);
    }
  }

  // 詳細パネルを開いたときに、全店のおすすめ数を最新にする（GAS 側でキャッシュしているので軽い）
  let refreshing = null;
  function refreshCounts() {
    if (refreshing) return;
    refreshing = fetchData()
      .then(({ counts }) => {
        // 送信中の店は、送信結果で上書きするのでここでは触らない
        const changed = new Set([...Object.keys(state.counts), ...Object.keys(counts)]);
        state.pending.forEach((id) => changed.delete(id));
        changed.forEach((id) => {
          const count = counts[id] || 0;
          if ((state.counts[id] || 0) === count) return;
          state.counts[id] = count;
          const marker = state.markers.get(id);
          if (marker) refreshMarker(marker.shop);
        });
        if (state.current && !state.pending.has(state.current.id)) renderSheet(state.current);
      })
      .catch((e) => console.warn('おすすめ数を更新できませんでした', e))
      .finally(() => { refreshing = null; });
  }

  // ---- 読み込み ----

  function showMessage(text) {
    const node = document.querySelector('.map-message');
    node.textContent = text;
    node.hidden = !text;
  }

  showMessage('お店を読み込んでいます…');
  fetchData()
    .then(({ shops, counts }) => {
      state.counts = counts;
      showMessage(shops.length ? '' : 'おすすめのお店はまだありません。もうしばらくお待ちください！');
      clusters.addLayers(shops.map((shop) => {
        const marker = L.marker([shop.lat, shop.lng], { icon: shopIcon(shop), title: shop.name, riseOnHover: true })
          .on('click', () => openSheet(shop));
        marker.shop = shop;
        state.markers.set(shop.id, marker);
        refreshMarker(shop);
        return marker;
      }));
    })
    .catch((e) => {
      console.error(e);
      showMessage(e.message || 'お店のデータを読み込めませんでした。ページを再読み込みしてください。');
    });
})();
