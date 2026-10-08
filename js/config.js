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
};
