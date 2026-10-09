(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const { GENRES, GENRE_ICONS, post, photoImg, shopIcon, createMap, areaBounds, toast } = window.Meshi;

  const PASSWORD_KEY = 'meshi-admin-password';
  const PHOTO_MAX_SIDE = 1280; // 写真はこの大きさ（長い辺のピクセル数）まで縮小してから送る
  const PHOTO_QUALITY = 0.8;

  const $ = (selector) => document.querySelector(selector);

  const state = {
    password: '',
    shops: [], // 追加済みの店（非表示も含む）
    candidates: null, // 検索候補（data/shops.json）
    form: null, // 編集中の内容 { mode: 'osm'|'manual'|'edit', shop, lat, lng, photo, photoChanged }
  };

  // ---- 画面の切り替え ----

  function show(viewId) {
    document.querySelectorAll('.admin-view').forEach((el) => { el.hidden = el.id !== viewId; });
    $('#logout').hidden = viewId === 'view-login';
    window.scrollTo(0, 0);
  }

  function showError(form, message) {
    const el = form.querySelector('.error');
    el.textContent = message || '';
    el.hidden = !message;
  }

  // ログインした端末では、ログアウトするまでパスワードを覚えておく（タブやブラウザを閉じても残る）。
  // ブラウザの保存領域は使えない場合もある（プライベートモードなど）ので、失敗しても止めない
  function storage(action, value) {
    try {
      if (action === 'get') return localStorage.getItem(PASSWORD_KEY) || '';
      if (action === 'set') localStorage.setItem(PASSWORD_KEY, value);
      if (action === 'remove') localStorage.removeItem(PASSWORD_KEY);
    } catch (e) {
      return '';
    }
    return '';
  }

  async function withBusy(button, busyText, task) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  // ---- ログイン ----

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showError(form, '');
    const password = $('#password').value;
    try {
      // 一覧の取得でパスワードも確認される（通信を1回で済ませる）
      const data = await withBusy(form.querySelector('button'), '確認中…',
        () => post({ action: 'adminList', password }));
      state.password = password;
      storage('set', password);
      $('#password').value = '';
      show('view-list');
      state.shops = data.shops;
      renderList();
    } catch (e) {
      showError(form, e.message);
    }
  });

  $('#logout').addEventListener('click', () => {
    state.password = '';
    storage('remove');
    show('view-login');
  });

  // ---- 追加済みの店の一覧 ----

  async function openList() {
    show('view-list');
    $('#list-summary').textContent = '読み込み中…';
    $('#shop-list').replaceChildren();
    try {
      const data = await post({ action: 'adminList', password: state.password });
      state.shops = data.shops;
      renderList();
    } catch (e) {
      $('#list-summary').textContent = `読み込めませんでした：${e.message}`;
      if (e.fromServer && /パスワード/.test(e.message)) {
        // 間違いが続いて一時停止しているだけなら、覚えているパスワードは消さない（解除後に開き直せばそのまま入れる）
        if (!/受け付けを止めています/.test(e.message)) storage('remove');
        show('view-login');
        showError($('#login-form'), e.message);
      }
    }
  }

  function renderList() {
    const visible = state.shops.filter((s) => s.visible).length;
    $('#list-summary').textContent = state.shops.length
      ? `追加済み ${state.shops.length}店（うち表示中 ${visible}店）`
      : 'まだ店がありません。「＋ 店を追加」から追加してください。';

    // 新しく追加した店を上に
    const shops = [...state.shops].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
    $('#shop-list').replaceChildren(...shops.map((shop) => {
      const li = document.createElement('li');
      li.className = 'shop-item' + (shop.visible ? '' : ' is-hidden');

      if (shop.photo) {
        li.appendChild(photoImg(shop.photo, 160, '', true));
      } else {
        const icon = document.createElement('span');
        icon.className = 'shop-item-icon';
        icon.textContent = GENRE_ICONS[shop.genre] || GENRE_ICONS['その他'];
        li.appendChild(icon);
      }

      const body = document.createElement('div');
      body.className = 'shop-item-body';
      const name = document.createElement('strong');
      name.textContent = shop.name;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = shop.genre + (shop.visible ? '' : '・非表示中');
      body.append(name, meta);
      if (shop.comment) {
        const comment = document.createElement('span');
        comment.className = 'shop-item-comment';
        comment.textContent = shop.comment;
        body.appendChild(comment);
      }
      li.appendChild(body);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'secondary-button small';
      edit.textContent = '編集';
      edit.addEventListener('click', () => openForm({ mode: 'edit', shop }));
      li.appendChild(edit);
      return li;
    }));
  }

  $('#start-add').addEventListener('click', openSearch);
  document.querySelectorAll('.back-button').forEach((b) => b.addEventListener('click', openList));

  // ---- 店名で検索 ----

  // 全角・半角、大文字・小文字、カタカナ・ひらがなの違いを無視して比べる
  function normalize(text) {
    return text.normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/\s+/g, '');
  }

  async function openSearch() {
    show('view-search');
    $('#search').value = '';
    $('#candidates').replaceChildren();
    if (!state.candidates) {
      try {
        const response = await fetch(config.CANDIDATES_URL, { cache: 'no-cache' });
        const data = await response.json();
        state.candidates = data.shops.map((s) => ({ ...s, key: normalize(s.name) }));
      } catch (e) {
        $('#candidates').textContent = '検索候補を読み込めませんでした。ページを再読み込みしてください。';
        return;
      }
    }
    $('#search').focus();
  }

  $('#search').addEventListener('input', () => {
    const query = normalize($('#search').value);
    const list = $('#candidates');
    if (!query || !state.candidates) {
      list.replaceChildren();
      return;
    }
    const added = new Set(state.shops.map((s) => s.id));
    const hits = state.candidates.filter((s) => s.key.includes(query)).slice(0, 30);
    if (!hits.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '見つかりませんでした。下のボタンから地図で位置を指定して追加できます。';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...hits.map((candidate) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'candidate';
      const name = document.createElement('strong');
      name.textContent = `${GENRE_ICONS[candidate.genre] || ''} ${candidate.name}`;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = [candidate.genre, candidate.address].filter(Boolean).join('・');
      button.append(name, meta);
      if (added.has(candidate.id)) {
        button.disabled = true;
        meta.textContent += '（追加済み）';
      } else {
        button.addEventListener('click', () => openForm({ mode: 'osm', shop: candidate }));
      }
      li.appendChild(button);
      return li;
    }));
  });

  $('#start-manual').addEventListener('click', () => openForm({ mode: 'manual', shop: { name: $('#search').value.trim() } }));

  // ---- 追加・編集フォーム ----

  let formMap;
  let formMarker;

  function setupFormMap() {
    if (formMap) return;
    formMap = createMap('form-map', { zoomControl: true });
    formMap.on('click', (event) => {
      if (state.form.mode !== 'manual') return;
      placeMarker(event.latlng);
    });
  }

  function placeMarker(latlng) {
    state.form.lat = latlng.lat;
    state.form.lng = latlng.lng;
    const draggable = state.form.mode !== 'edit';
    const icon = shopIcon({ genre: $('#shop-genre').value });
    if (formMarker) {
      formMarker.setLatLng(latlng).setIcon(icon);
    } else {
      formMarker = L.marker(latlng, { icon, draggable }).addTo(formMap);
      formMarker.on('dragend', () => {
        const pos = formMarker.getLatLng();
        state.form.lat = pos.lat;
        state.form.lng = pos.lng;
      });
    }
    if (draggable) formMarker.dragging.enable(); else formMarker.dragging.disable();
  }

  // GENRES の選択肢は最初に1回だけ作る
  $('#shop-genre').replaceChildren(...GENRES.map((g) => {
    const option = document.createElement('option');
    option.value = g;
    option.textContent = `${GENRE_ICONS[g]} ${g}`;
    return option;
  }));
  $('#shop-genre').addEventListener('change', () => {
    if (formMarker && state.form.lat != null) placeMarker(L.latLng(state.form.lat, state.form.lng));
  });

  function openForm({ mode, shop }) {
    state.form = {
      mode,
      shop,
      lat: shop.lat,
      lng: shop.lng,
      photo: shop.photo ? { fileId: shop.photo } : null,
      photoChanged: false,
    };
    show('view-form');
    const form = $('#shop-form');
    showError(form, '');

    $('#form-title').textContent = mode === 'edit' ? `「${shop.name}」を編集` : '店を追加';
    $('#form-submit').textContent = mode === 'edit' ? '保存する' : 'この店を追加する';
    $('#map-hint').textContent = {
      osm: 'ピンの位置がずれていたら、ドラッグして直せます。',
      manual: '地図をタップして、店の位置にピンを置いてください。',
      edit: '位置は変更できません。',
    }[mode];
    $('#shop-name').value = shop.name || '';
    $('#shop-genre').value = shop.genre || 'その他';
    $('#shop-comment').value = shop.comment || '';
    $('#shop-photo').value = '';
    $('#visible-row').hidden = mode !== 'edit';
    $('#shop-visible').checked = mode !== 'edit' || shop.visible;
    updateCounter();
    renderPhoto();

    // 地図は表示されてから大きさを確定させる
    setupFormMap();
    if (formMarker) {
      formMarker.remove();
      formMarker = null;
    }
    formMap.invalidateSize();
    // ピンは地図の表示位置を決めてから置く（決まる前だと Leaflet がピンの初期化を後回しにする）
    if (shop.lat != null) {
      formMap.setView([shop.lat, shop.lng], 17, { animate: false });
      placeMarker(L.latLng(shop.lat, shop.lng));
    } else {
      formMap.fitBounds(areaBounds(), { animate: false });
    }
  }

  function updateCounter() {
    $('#comment-counter').textContent = `${$('#shop-comment').value.length} / 200`;
  }
  $('#shop-comment').addEventListener('input', updateCounter);

  function renderPhoto() {
    const preview = $('#photo-preview');
    const photo = state.form.photo;
    if (!photo) {
      preview.replaceChildren();
    } else if (photo.dataUrl) {
      const img = document.createElement('img');
      img.src = photo.dataUrl;
      img.alt = '選んだ写真';
      preview.replaceChildren(img);
    } else {
      preview.replaceChildren(photoImg(photo.fileId, 600, '登録済みの写真'));
    }
    preview.hidden = !photo;
    $('#photo-remove').hidden = !photo;
  }

  $('#shop-photo').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      state.form.photo = { dataUrl: await resizePhoto(file) };
      state.form.photoChanged = true;
      renderPhoto();
    } catch (e) {
      console.error(e);
      showError($('#shop-form'), 'この写真は読み込めませんでした。別の写真を選んでください。');
    }
  });

  $('#photo-remove').addEventListener('click', () => {
    state.form.photo = null;
    state.form.photoChanged = true;
    $('#shop-photo').value = '';
    renderPhoto();
  });

  // スマホの写真は大きい（数MB）ので、長い辺を PHOTO_MAX_SIDE にした JPEG にしてから送る
  async function resizePhoto(file) {
    const image = await loadImage(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
  }

  async function loadImage(file) {
    // createImageBitmap は写真の向き（縦横）情報も反映してくれる
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (e) { /* 下の方法で読み直す */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $('#shop-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showError(form, '');
    const f = state.form;
    const name = $('#shop-name').value.trim();
    if (!name) return showError(form, '店名を入力してください');
    if (f.lat == null) return showError(form, '地図をタップして、店の位置を指定してください');

    const photo = f.photo && f.photo.dataUrl;
    let request;
    if (f.mode === 'edit') {
      const changes = {
        name,
        genre: $('#shop-genre').value,
        comment: $('#shop-comment').value,
        visible: $('#shop-visible').checked,
      };
      if (f.photoChanged) changes.photo = photo || '';
      request = { action: 'adminUpdate', password: state.password, id: f.shop.id, changes };
    } else {
      request = {
        action: 'adminAdd',
        password: state.password,
        shop: {
          id: f.mode === 'osm' ? f.shop.id : undefined,
          name,
          lat: f.lat,
          lng: f.lng,
          genre: $('#shop-genre').value,
          address: f.shop.address,
          hours: f.shop.hours,
        },
        comment: $('#shop-comment').value,
        photo: photo || undefined,
      };
    }

    try {
      await withBusy($('#form-submit'), photo ? '写真を送信中…' : '送信中…', () => post(request));
      toast(f.mode === 'edit' ? '保存しました' : `「${name}」を追加しました`);
      await openList();
    } catch (e) {
      // 通信の失敗は「サーバーには届いて保存されたが、返事だけ届かなかった」こともある
      showError(form, e.fromServer ? e.message : `${e.message}（保存できている場合もあるので、一覧に戻って確認してください）`);
    }
  });

  // ---- 起動 ----

  state.password = storage('get');
  if (state.password) {
    openList();
  } else {
    show('view-login');
  }
})();
