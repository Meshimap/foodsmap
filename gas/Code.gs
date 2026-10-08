/**
 * 水道橋・秋葉原 おすすめ飯屋マップ — サーバー側（Google Apps Script）
 *
 * スプレッドシートの「拡張機能 → Apps Script」に、このファイルの中身をそのまま貼り付けて使う。
 * 公開されている GitHub にもこのファイルはあるが、パスワードはここには書かず、
 * スプレッドシートのメニュー「飯屋マップ → 管理パスワードを設定」でスクリプトプロパティに保存する。
 */

const SHEET_SHOPS = '店';
const SHEET_RECS = 'おすすめ';
const SHOP_HEADERS = ['店ID', '店名', '緯度', '経度', 'ジャンル', '住所', '営業時間', '一言', '写真ID', '表示', '追加日時'];
const REC_HEADERS = ['日時', '店ID', '端末ID', '取消', '無効'];
// 列の位置（0始まり）
const S = { id: 0, name: 1, lat: 2, lng: 3, genre: 4, address: 5, hours: 6, comment: 7, photo: 8, visible: 9, addedAt: 10 };
const R = { at: 0, shopId: 1, deviceId: 2, cancelled: 3, invalid: 4 };

const GENRES = ['ラーメン', 'カレー', '和食', '洋食', '中華・アジア', 'ファストフード', 'カフェ・甘味', 'パン', 'その他'];
const LIMITS = { name: 60, address: 120, hours: 120, comment: 200, photoChars: 2000000 };
// 店の位置として受け付ける範囲（水道橋・秋葉原周辺のおおまかな四角）
const AREA_BOUNDS = { minLat: 35.68, maxLat: 35.72, minLng: 139.73, maxLng: 139.80 };

const CACHE_KEY = 'public-data-v1';
const CACHE_SECONDS = 600; // 書き込み時に作り直すので、これは保険の有効期限
const RATE = { max: 10, seconds: 60 }; // 1端末あたりのおすすめ操作の上限
const LOGIN = { maxFails: 10, lockSeconds: 600 }; // パスワードを連続で間違えたら一時停止

class UserError extends Error {}

// ---------------------------------------------------------------
// スプレッドシートのメニュー
// ---------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('飯屋マップ')
    .addItem('初期設定（最初に1回）', 'setup')
    .addItem('管理パスワードを設定', 'setAdminPassword')
    .addItem('サイトの表示を今すぐ更新', 'clearCache')
    .addToUi();
}

// 運営がシートを手で編集したら（おすすめの「無効」にチェック等）、サイトの表示に反映させる
function onEdit() {
  clearCache();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  prepareSheet_(ss, SHEET_SHOPS, SHOP_HEADERS, [S.visible],
    [S.id, S.name, S.genre, S.address, S.hours, S.comment, S.photo]);
  prepareSheet_(ss, SHEET_RECS, REC_HEADERS, [R.cancelled, R.invalid], [R.shopId, R.deviceId]);
  const blank = ss.getSheetByName('シート1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  photoFolder_();
  clearCache();
  SpreadsheetApp.getUi().alert('初期設定が終わりました。次に「飯屋マップ → 管理パスワードを設定」を行ってください。');
}

function setAdminPassword() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('管理パスワードを設定', '運営メンバーで共有するパスワード（8文字以上）を入力してください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const password = res.getResponseText();
  if (password.length < 8) {
    ui.alert('8文字以上にしてください。設定は変わっていません。');
    return;
  }
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({ ADMIN_SALT: salt, ADMIN_HASH: hash_(salt + password) });
  ui.alert('管理パスワードを設定しました。');
}

function clearCache() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// ---------------------------------------------------------------
// Webアプリの入口
// ---------------------------------------------------------------

// サイトを開いたとき：表示中の店とおすすめ数を返す
function doGet() {
  return json_({ ok: true, ...publicData_() });
}

// おすすめ・管理操作。サイトからは text/plain の JSON で送る（ブラウザの事前確認通信を避けるため）
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'recommend': return json_(recommend_(body));
      case 'adminLogin': requireAdmin_(body.password); return json_({ ok: true });
      case 'adminList': requireAdmin_(body.password); return json_({ ok: true, shops: readShops_() });
      case 'adminAdd': requireAdmin_(body.password); return json_(addShop_(body));
      case 'adminUpdate': requireAdmin_(body.password); return json_(updateShop_(body));
      default: throw new UserError('不明な操作です');
    }
  } catch (err) {
    if (err instanceof UserError) return json_({ ok: false, error: err.message });
    console.error(err);
    return json_({ ok: false, error: 'サーバーでエラーが起きました。少し待ってからもう一度お試しください。' });
  }
}

// ---------------------------------------------------------------
// 来場者向け
// ---------------------------------------------------------------

function publicData_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const shops = readShops_()
    .filter((s) => s.visible)
    .map(({ visible, addedAt, ...shop }) => shop);
  const counts = countRecs_(readRecs_());
  const visibleIds = new Set(shops.map((s) => s.id));
  Object.keys(counts).forEach((id) => { if (!visibleIds.has(id)) delete counts[id]; });
  const data = { shops, counts };
  putCache_(data);
  return data;
}

function recommend_(body) {
  const deviceId = String(body.deviceId || '');
  const shopId = String(body.shopId || '');
  const on = body.on === true;
  if (!/^[A-Za-z0-9-]{16,64}$/.test(deviceId)) throw new UserError('端末の識別子が正しくありません');

  checkRate_(deviceId);
  if (!publicData_().shops.some((s) => s.id === shopId)) throw new UserError('このお店は見つかりませんでした');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new UserError('混み合っています。少し待ってからもう一度押してください。');
  try {
    const sheet = sheet_(SHEET_RECS);
    const rows = readRecs_();
    // 取消していない行があれば「おすすめ済み」（運営が無効にした行も含む＝同じ端末から再度おすすめできない）
    const index = rows.findIndex((r) => r[R.shopId] === shopId && r[R.deviceId] === deviceId && !isTrue_(r[R.cancelled]));
    if (on && index < 0) {
      const row = [new Date(), shopId, deviceId, false, false];
      sheet.appendRow(row);
      rows.push(row);
    } else if (!on && index >= 0) {
      sheet.getRange(index + 2, R.cancelled + 1).setValue(true);
      rows[index][R.cancelled] = true;
    }
    const count = countRecs_(rows)[shopId] || 0;

    // キャッシュがあれば、その店の数だけ書き換える（無ければ次に開かれたときシートから作り直される）
    const cached = CacheService.getScriptCache().get(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      if (count > 0) data.counts[shopId] = count; else delete data.counts[shopId];
      putCache_(data);
    }
    return { ok: true, on, count };
  } finally {
    lock.releaseLock();
  }
}

function checkRate_(deviceId) {
  const cache = CacheService.getScriptCache();
  const key = 'rate:' + deviceId;
  const n = Number(cache.get(key) || 0);
  if (n >= RATE.max) throw new UserError('操作が多すぎます。1分ほど待ってからもう一度お試しください。');
  cache.put(key, String(n + 1), RATE.seconds);
}

// ---------------------------------------------------------------
// 管理ページ向け
// ---------------------------------------------------------------

function requireAdmin_(password) {
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('ADMIN_SALT');
  const expected = props.getProperty('ADMIN_HASH');
  if (!salt || !expected) throw new UserError('管理パスワードがまだ設定されていません');

  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login-fails') || 0);
  if (fails >= LOGIN.maxFails) throw new UserError('パスワードの間違いが続いたため、10分ほど受け付けを止めています');
  if (hash_(salt + String(password || '')) !== expected) {
    cache.put('login-fails', String(fails + 1), LOGIN.lockSeconds);
    throw new UserError('パスワードが違います');
  }
}

function addShop_(body) {
  const input = body.shop || {};
  const id = input.id ? String(input.id) : 'manual/' + Utilities.getUuid().slice(0, 8);
  if (!/^((node|way|relation)\/\d+|manual\/[0-9a-f]{8})$/.test(id)) throw new UserError('店IDが正しくありません');

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!(lat >= AREA_BOUNDS.minLat && lat <= AREA_BOUNDS.maxLat && lng >= AREA_BOUNDS.minLng && lng <= AREA_BOUNDS.maxLng)) {
    throw new UserError('店の位置が対象エリアの外です');
  }
  const name = text_(input.name, LIMITS.name);
  if (!name) throw new UserError('店名を入力してください');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new UserError('混み合っています。少し待ってからもう一度お試しください。');
  try {
    const existing = readShops_().find((s) => s.id === id);
    if (existing) {
      throw new UserError(existing.visible ? 'このお店はすでに追加されています' : 'このお店は非表示になっています。一覧から「表示する」に戻してください');
    }
    const photoId = body.photo ? savePhoto_(body.photo) : '';
    const row = [];
    row[S.id] = id;
    row[S.name] = name;
    row[S.lat] = lat;
    row[S.lng] = lng;
    row[S.genre] = GENRES.includes(input.genre) ? input.genre : 'その他';
    row[S.address] = text_(input.address, LIMITS.address);
    row[S.hours] = text_(input.hours, LIMITS.hours);
    row[S.comment] = text_(body.comment, LIMITS.comment);
    row[S.photo] = photoId;
    row[S.visible] = true;
    row[S.addedAt] = new Date();
    sheet_(SHEET_SHOPS).appendRow(row.map(cell_));
    clearCache();
    return { ok: true, shop: readShops_().find((s) => s.id === id) };
  } finally {
    lock.releaseLock();
  }
}

// 変更できるのは 店名・ジャンル・一言・写真・表示 だけ。photo は '' で削除、data URL で差し替え
function updateShop_(body) {
  const id = String(body.id || '');
  const changes = body.changes || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new UserError('混み合っています。少し待ってからもう一度お試しください。');
  try {
    const sheet = sheet_(SHEET_SHOPS);
    const values = sheet.getDataRange().getValues();
    const index = values.findIndex((r, i) => i > 0 && r[S.id] === id);
    if (index < 0) throw new UserError('このお店は見つかりませんでした');
    const row = values[index];

    if ('name' in changes) {
      const name = text_(changes.name, LIMITS.name);
      if (!name) throw new UserError('店名を入力してください');
      row[S.name] = name;
    }
    if ('genre' in changes) row[S.genre] = GENRES.includes(changes.genre) ? changes.genre : 'その他';
    if ('comment' in changes) row[S.comment] = text_(changes.comment, LIMITS.comment);
    if ('visible' in changes) row[S.visible] = changes.visible === true;
    if ('photo' in changes) {
      const oldPhoto = row[S.photo];
      row[S.photo] = changes.photo ? savePhoto_(changes.photo) : '';
      // 古い写真はドライブのゴミ箱へ（30日間は復元できる）
      if (oldPhoto) {
        try { DriveApp.getFileById(oldPhoto).setTrashed(true); } catch (e) { console.warn(e); }
      }
    }
    sheet.getRange(index + 1, 1, 1, row.length).setValues([row.map(cell_)]);
    clearCache();
    return { ok: true, shop: readShops_().find((s) => s.id === id) };
  } finally {
    lock.releaseLock();
  }
}

// 写真はブラウザで縮小済みの JPEG（data URL）を受け取り、ドライブに保存して「リンクを知っている全員が閲覧可」にする
function savePhoto_(dataUrl) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!match) throw new UserError('写真の形式が正しくありません');
  if (match[1].length > LIMITS.photoChars) throw new UserError('写真が大きすぎます');
  const blob = Utilities.newBlob(Utilities.base64Decode(match[1]), 'image/jpeg', 'photo-' + Date.now() + '.jpg');
  const file = photoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

// ---------------------------------------------------------------
// シートの読み書き
// ---------------------------------------------------------------

function readShops_() {
  const values = sheet_(SHEET_SHOPS).getDataRange().getValues().slice(1);
  return values
    .filter((r) => r[S.id])
    .map((r) => {
      const shop = {
        id: String(r[S.id]),
        name: String(r[S.name]),
        lat: Number(r[S.lat]),
        lng: Number(r[S.lng]),
        genre: String(r[S.genre] || 'その他'),
        address: String(r[S.address] || ''),
        hours: String(r[S.hours] || ''),
        comment: String(r[S.comment] || ''),
        photo: String(r[S.photo] || ''),
        visible: isTrue_(r[S.visible]),
        addedAt: r[S.addedAt] instanceof Date ? r[S.addedAt].toISOString() : '',
      };
      // 空の項目は送らない
      Object.keys(shop).forEach((k) => { if (shop[k] === '') delete shop[k]; });
      return shop;
    });
}

function readRecs_() {
  const sheet = sheet_(SHEET_RECS);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, REC_HEADERS.length).getValues();
}

function countRecs_(rows) {
  const counts = {};
  rows.forEach((r) => {
    if (r[R.shopId] && !isTrue_(r[R.cancelled]) && !isTrue_(r[R.invalid])) {
      counts[r[R.shopId]] = (counts[r[R.shopId]] || 0) + 1;
    }
  });
  return counts;
}

// textColumns は「書式なしテキスト」にする（営業時間の 11:00 などが時刻に自動変換されないように）
function prepareSheet_(ss, name, headers, checkboxColumns, textColumns) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  checkboxColumns.forEach((col) => {
    sheet.getRange(2, col + 1, sheet.getMaxRows() - 1, 1).setDataValidation(checkbox);
  });
  textColumns.forEach((col) => {
    sheet.getRange(2, col + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  });
}

function sheet_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('シート「' + name + '」がありません。メニューの「初期設定」を実行してください');
  return sheet;
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { console.warn('写真フォルダが見つからないので作り直します', e); }
  }
  const folder = DriveApp.createFolder('飯屋マップ 写真');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// ---------------------------------------------------------------
// 小さな道具
// ---------------------------------------------------------------

function putCache_(data) {
  try {
    CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(data), CACHE_SECONDS);
  } catch (e) {
    // キャッシュは1件100KBまで。超えたら毎回シートから読む（動作は続く）
    console.warn('キャッシュに保存できませんでした', e);
  }
}

function text_(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// = + - @ で始まる文字はスプレッドシートが数式として扱うので、先頭に ' を付けて文字として保存する
function cell_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function isTrue_(value) {
  return value === true || value === 'TRUE';
}

function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2))
    .join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
