(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const { createMap, areaBounds, shopIcon, fetchData, photoImg, GENRE_ICONS } = window.Meshi;

  // 両エリアがちょうど収まる範囲で地図を開く
  const bounds = areaBounds();
  const map = createMap('map', { zoomControl: true });
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

  // ---- 店のアイコン ----

  // 密集した店は数字入りの丸にまとめる。拡大すると個々のアイコンに分かれる
  const clusters = L.markerClusterGroup({
    maxClusterRadius: 45,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
  });
  map.addLayer(clusters);

  // ---- 詳細パネル ----

  const state = { counts: {}, recommended: new Set(), current: null };
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

    // おすすめ（ステップ9で GAS とつなぐ。今は見た目だけ）
    const rec = el('div', 'recommend');
    rec.appendChild(el('p', 'recommend-count', count > 0 ? `${count}人がおすすめ` : 'まだおすすめはありません'));
    const button = el('button', 'recommend-button' + (done ? ' is-done' : ''), done ? 'おすすめ済み ✓' : 'おすすめ！');
    button.type = 'button';
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

  function openSheet(shop) {
    state.current = shop;
    renderSheet(shop);
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
    // 店のアイコンがパネルに隠れないよう、地図の見える部分の中央あたりに寄せる
    const hiddenHeight = window.innerWidth >= 768 ? 0 : sheet.offsetHeight;
    const point = map.latLngToContainerPoint([shop.lat, shop.lng]);
    const target = L.point(map.getSize().x / 2, (map.getSize().y - hiddenHeight) / 2);
    map.panBy(point.subtract(target), { duration: 0.4 });
  }

  function closeSheet() {
    sheet.hidden = true;
    state.current = null;
  }

  sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);
  map.on('click', closeSheet);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet();
  });

  // 仮の動き（ステップ9で GAS に保存する形に置き換える）
  function toggleRecommend(shop) {
    const on = !state.recommended.has(shop.id);
    if (on) state.recommended.add(shop.id); else state.recommended.delete(shop.id);
    state.counts[shop.id] = Math.max(0, (state.counts[shop.id] || 0) + (on ? 1 : -1));
    renderSheet(shop);
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
      clusters.addLayers(shops.map((shop) =>
        L.marker([shop.lat, shop.lng], { icon: shopIcon(shop), title: shop.name })
          .on('click', () => openSheet(shop))
      ));
    })
    .catch((e) => {
      console.error(e);
      showMessage(e.message || 'お店のデータを読み込めませんでした。ページを再読み込みしてください。');
    });
})();
