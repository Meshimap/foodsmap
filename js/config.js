// サイトの設定。運営が変更しうる値はここにまとめる。
window.APP_CONFIG = {
  // 対象エリア（駅の位置と、店を集める半径[メートル]）
  AREAS: [
    { id: 'suidobashi', name: '水道橋', lat: 35.7020, lng: 139.7536, radius: 500 },
    { id: 'akihabara',  name: '秋葉原', lat: 35.6984, lng: 139.7731, radius: 500 },
  ],
  // エリアボタンで移動したときのズーム
  AREA_ZOOM: 16,
  // 店舗データ（OSMから取得したもの）
  SHOPS_URL: 'data/shops.json',
};
