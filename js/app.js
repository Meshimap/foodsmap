(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const { createMap, areaBounds, shopIcon, fetchData, photoImg } = window.Meshi;

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

  // 仮の表示（ステップ8で画面下から出る詳細パネルに置き換える）。文字は textContent で入れて HTML として解釈させない
  function popupContent(shop) {
    const el = document.createElement('div');
    el.className = 'shop-popup';
    const name = document.createElement('strong');
    name.textContent = shop.name;
    const genre = document.createElement('div');
    genre.textContent = shop.genre;
    el.append(name, genre);
    if (shop.photo) el.appendChild(photoImg(shop.photo, 400, shop.name));
    if (shop.comment) {
      const comment = document.createElement('p');
      comment.textContent = shop.comment;
      el.appendChild(comment);
    }
    return el;
  }

  function showMessage(text) {
    const el = document.querySelector('.map-message');
    el.textContent = text;
    el.hidden = !text;
  }

  showMessage('お店を読み込んでいます…');
  fetchData()
    .then(({ shops }) => {
      showMessage(shops.length ? '' : 'おすすめのお店はまだありません。もうしばらくお待ちください！');
      clusters.addLayers(shops.map((shop) =>
        L.marker([shop.lat, shop.lng], { icon: shopIcon(shop), title: shop.name })
          .bindPopup(() => popupContent(shop), { maxWidth: 260 })
      ));
    })
    .catch((e) => {
      console.error(e);
      showMessage('お店のデータを読み込めませんでした。ページを再読み込みしてください。');
    });
})();
