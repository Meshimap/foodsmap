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
})();
