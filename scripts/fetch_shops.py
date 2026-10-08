"""OpenStreetMap から対象エリアの飲食店を取得し、data/shops.json に保存する。

使い方（プロジェクトのフォルダで）:
    python scripts/fetch_shops.py

- 対象エリア（駅の位置と半径）は js/config.js の AREAS から読み取る
- Overpass API（OSMデータの無料の検索窓口）を1回だけ呼ぶ。登録・費用は不要
- 載せない店（全国チェーン・メイドカフェなど）のルールは data/exclude.json に書く
- 運営が手で追加する店は data/extra_shops.json に書く（このスクリプトは触らない）
"""

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_JS = ROOT / "js" / "config.js"
OUTPUT = ROOT / "data" / "shops.json"
EXCLUDE_JSON = ROOT / "data" / "exclude.json"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "meshiMap-fetch/1.0 (school festival restaurant map)"

AMENITIES = ["restaurant", "fast_food", "cafe", "food_court", "ice_cream"]
SHOPS = ["bakery"]

# cuisine タグ → ジャンル。cuisine は "ramen;japanese" のように複数入ることがあり、先に書かれたものを優先する
CUISINE_GENRES = {
    "ラーメン": ["ramen", "noodle", "chinese_noodle", "tsukemen", "tantanmen"],
    "カレー": ["curry", "indian", "nepalese", "soup_curry"],
    "和食": ["japanese", "sushi", "soba", "udon", "tempura", "tonkatsu", "yakitori", "okonomiyaki",
             "takoyaki", "donburi", "beef_bowl", "gyudon", "teishoku", "kaiseki", "unagi", "yakiniku",
             "oden", "onigiri", "washoku", "izakaya", "katsudon", "kushikatsu", "shabu-shabu", "sukiyaki",
             "monjayaki", "seafood", "fish", "rice"],
    "洋食": ["italian", "french", "pizza", "pasta", "steak_house", "steak", "western", "spanish", "american",
            "european", "german", "omurice", "hamburg", "grill", "bistro", "mexican", "brazilian"],
    "中華・アジア": ["chinese", "korean", "thai", "vietnamese", "asian", "taiwanese", "dim_sum", "dumpling",
                 "gyoza", "malaysian", "indonesian", "turkish", "middle_eastern", "halal"],
    "ファストフード": ["burger", "chicken", "fried_chicken", "sandwich", "hot_dog", "kebab", "fries"],
    "カフェ・甘味": ["coffee_shop", "coffee", "cake", "dessert", "crepe", "pancake", "tea", "ice_cream",
                "donut", "bubble_tea", "sweets", "wagashi", "parfait", "frozen_yogurt", "juice"],
    "パン": ["bakery", "bread"],
}
CUISINE_TO_GENRE = {c: genre for genre, cuisines in CUISINE_GENRES.items() for c in cuisines}
CUISINE_TO_GENRE.update({
    "barbecue": "和食", "gyukatsu": "和食", "teppanyaki": "和食", "italian_pizza": "洋食",
    "焼肉": "和食", "鉄板焼": "和食", "寿司": "和食", "ラーメン": "ラーメン",
})

# cuisine が入っていない店は多いので、店名に含まれる言葉からもジャンルを推定する（上から順に判定）
NAME_KEYWORDS = [
    ("カレー", ["カレー", "curry", "CURRY", "Curry"]),
    ("ラーメン", ["ラーメン", "らーめん", "拉麺", "中華そば", "つけ麺", "麺屋", "麺処", "らぁ麺", "ramen", "RAMEN"]),
    ("中華・アジア", ["中華", "餃子", "飯店", "菜館", "酒家", "韓国", "タイ料理", "ベトナム", "台湾"]),
    ("和食", ["寿司", "鮨", "すし", "そば", "蕎麦", "うどん", "とんかつ", "天ぷら", "天丼", "焼肉", "焼鳥", "焼き鳥",
             "やきとり", "定食", "食堂", "丼", "牛たん", "牛タン", "鰻", "うなぎ", "割烹", "居酒屋", "串", "酒場",
             "お好み焼", "もんじゃ", "おにぎり", "ジンギスカン", "ホルモン", "しゃぶ", "牛かつ", "やきとん", "海鮮",
             "魚がし"]),
    ("洋食", ["洋食", "パスタ", "ピザ", "ピッツァ", "イタリアン", "トラットリア", "ビストロ", "ステーキ", "ハンバーグ",
             "オムライス", "グリル", "ハンブルグ", "ローストビーフ", "Osteria", "Trattoria", "Bistro", "Pizza"]),
    ("カフェ・甘味", ["カフェ", "珈琲", "コーヒー", "喫茶", "Cafe", "CAFE", "cafe", "Coffee", "COFFEE"]),
    ("パン", ["ベーカリー", "パン", "Bakery", "BAKERY"]),
]

# cuisine が無い・わからないときの、種類ごとの既定ジャンル
DEFAULT_GENRE = {
    "bakery": "パン",
    "cafe": "カフェ・甘味",
    "ice_cream": "カフェ・甘味",
    "fast_food": "ファストフード",
}

ADDRESS_KEYS = ["addr:province", "addr:city", "addr:suburb", "addr:quarter", "addr:neighbourhood"]


def read_areas():
    text = CONFIG_JS.read_text(encoding="utf-8")
    areas = [
        {"name": m.group(1), "lat": float(m.group(2)), "lng": float(m.group(3)), "radius": int(m.group(4))}
        for m in re.finditer(
            r"name:\s*'([^']+)',\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+),\s*radius:\s*(\d+)", text
        )
    ]
    if not areas:
        sys.exit(f"エラー: {CONFIG_JS} から AREAS を読み取れませんでした")
    return areas


def build_query(areas):
    parts = []
    for a in areas:
        around = f"(around:{a['radius']},{a['lat']},{a['lng']})"
        parts.append(f'nwr["amenity"~"^({"|".join(AMENITIES)})$"]{around};')
        parts.append(f'nwr["shop"~"^({"|".join(SHOPS)})$"]{around};')
    # out center: 建物として描かれた店（way）も中心の座標を返す
    return "[out:json][timeout:90];\n(\n  " + "\n  ".join(parts) + "\n);\nout center tags;"


def fetch(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as e:
            # 429/504 は Overpass が混雑しているだけなので、少し待って再試行する
            if e.code in (429, 504) and attempt < 2:
                print(f"Overpass が混雑中（{e.code}）。60秒後に再試行します…")
                time.sleep(60)
                continue
            sys.exit(
                f"取得に失敗しました（{e.code}）。{OUTPUT.name} は前回の内容のまま変わっていません。\n"
                "Overpass は無料の公開サーバーで、混雑していることがあります。数分おいてもう一度実行してください。"
            )
        except urllib.error.URLError as e:
            sys.exit(f"Overpass に接続できませんでした（{e.reason}）。インターネット接続を確認してください。")


def genre_of(tags):
    for cuisine in tags.get("cuisine", "").split(";"):
        genre = CUISINE_TO_GENRE.get(cuisine.strip().lower())
        if genre:
            return genre
    name = tags.get("name:ja") or tags.get("name", "")
    for genre, words in NAME_KEYWORDS:
        if any(w in name for w in words):
            return genre
    kind = tags.get("shop") or tags.get("amenity")
    return DEFAULT_GENRE.get(kind, "その他")


def address_of(tags):
    if tags.get("addr:full"):
        return tags["addr:full"]
    area = "".join(tags[k] for k in ADDRESS_KEYS if tags.get(k))
    number = "-".join(tags[k] for k in ("addr:block_number", "addr:housenumber") if tags.get(k))
    # 町名などが無く番地だけの住所は、かえってわかりにくいので出さない
    return area + number if area else None


def load_exclude():
    rules = json.loads(EXCLUDE_JSON.read_text(encoding="utf-8"))
    return {
        "chains": rules.get("chains", []),
        "name_keywords": rules.get("name_keywords", []),
        "tags": rules.get("tags", {}),
        "names": set(rules.get("names", [])),
        "ids": set(rules.get("ids", [])),
    }


def exclude_reason(element, rules):
    """除外する店なら理由を、載せる店なら None を返す"""
    tags = element.get("tags", {})
    if f"{element['type']}/{element['id']}" in rules["ids"]:
        return "ID指定"
    for key, values in rules["tags"].items():
        if tags.get(key) in values:
            return f"タグ {key}={tags[key]}"
    names = [tags.get(k, "") for k in ("name", "name:ja", "name:en")]
    if rules["names"] & set(names):
        return "店名指定"
    brands = {tags.get(k) for k in ("brand", "brand:ja", "brand:en")} - {None}
    for chain in rules["chains"]:
        if chain in brands or any(chain in n for n in names):
            return f"チェーン「{chain}」"
    for word in rules["name_keywords"]:
        if any(word in n for n in names):
            return f"店名に「{word}」"
    return None


def to_shop(element):
    tags = element.get("tags", {})
    name = tags.get("name:ja") or tags.get("name")
    if not name:
        return None
    lat = element.get("lat", element.get("center", {}).get("lat"))
    lng = element.get("lon", element.get("center", {}).get("lon"))
    if lat is None or lng is None:
        return None
    shop = {
        "id": f"{element['type']}/{element['id']}",
        "name": name,
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "genre": genre_of(tags),
        "address": address_of(tags),
        "hours": tags.get("opening_hours"),
    }
    return {k: v for k, v in shop.items() if v is not None}


def write_output(shops):
    OUTPUT.parent.mkdir(exist_ok=True)
    generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    # 1店1行で書き出す（再取得したときに、どの店が変わったか差分で見やすい）
    lines = [json.dumps(s, ensure_ascii=False, separators=(",", ":")) for s in shops]
    OUTPUT.write_text(
        "{\n"
        f'"generated_at":"{generated_at}",\n'
        '"attribution":"© OpenStreetMap contributors (ODbL)",\n'
        '"shops":[\n' + ",\n".join(lines) + "\n]\n}\n",
        encoding="utf-8",
        newline="\n",
    )


def main():
    areas = read_areas()
    print("対象エリア:", "、".join(f"{a['name']}（半径{a['radius']}m）" for a in areas))
    rules = load_exclude()
    data = fetch(build_query(areas))

    shops, unnamed, excluded = [], 0, []
    for element in data["elements"]:
        shop = to_shop(element)
        if not shop:
            unnamed += 1
            continue
        reason = exclude_reason(element, rules)
        if reason:
            excluded.append((shop["name"], reason))
        else:
            shops.append(shop)
    shops.sort(key=lambda s: s["id"])
    write_output(shops)

    print(f"除外した店（{len(excluded)}件）:")
    for name, reason in sorted(excluded, key=lambda x: x[1]):
        print(f"  {name} … {reason}")
    print(f"保存しました: {OUTPUT.relative_to(ROOT)}（{len(shops)}件。名前の無い {unnamed}件も除外）")
    counts = {}
    for s in shops:
        counts[s["genre"]] = counts.get(s["genre"], 0) + 1
    for genre, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {genre}: {n}")


if __name__ == "__main__":
    main()
