"""OpenStreetMap から日本大学経済学部の建物の形を取得し、data/venue.json（GeoJSON）に保存する。
トップページの地図で、この建物を赤枠で囲って目立たせるのに使う。

使い方（プロジェクトのフォルダで）:
    python scripts/fetch_venue.py

建物は OSM の ID で指定し、OSM 本体の公開API（1件ずつ地物を読む窓口）から読む。
建物を増やす・減らすときは BUILDINGS を編集する（ID は https://www.openstreetmap.org で建物をクリックすると分かる）。
"""

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "venue.json"
API = "https://api.openstreetmap.org/api/0.6"
USER_AGENT = "meshiMap-fetch/1.0 (school festival restaurant map)"

BUILDINGS = [
    ("relation", 5720019),  # 本館
    ("way", 210687449),  # 2号館
    ("way", 171477363),  # 3号館
    ("way", 171215879),  # 7号館
    ("way", 171477351),  # 8号館
]


def get(path):
    request = urllib.request.Request(f"{API}/{path}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)["elements"]


def ring(way, nodes):
    # GeoJSON は [経度, 緯度] の順
    return [[round(nodes[n]["lon"], 7), round(nodes[n]["lat"], 7)] for n in way["nodes"]]


def to_feature(kind, osm_id):
    elements = get(f"{kind}/{osm_id}/full.json")
    nodes = {e["id"]: e for e in elements if e["type"] == "node"}
    ways = {e["id"]: e for e in elements if e["type"] == "way"}
    target = next(e for e in elements if e["type"] == kind and e["id"] == osm_id)
    if kind == "way":
        outlines = [target]
    else:
        # 外形だけを使う（中庭のある建物は "outer"、階数の違う部分をまとめた建物は "outline"）
        outlines = [ways[m["ref"]] for m in target["members"]
                    if m["type"] == "way" and m.get("role") in ("outer", "outline") and m["ref"] in ways]
    return {
        "type": "Feature",
        "properties": {"name": target["tags"].get("name", ""), "id": f"{kind}/{osm_id}"},
        "geometry": {"type": "MultiPolygon", "coordinates": [[ring(w, nodes)] for w in outlines]},
    }


def main():
    try:
        features = [to_feature(kind, osm_id) for kind, osm_id in BUILDINGS]
    except Exception as e:  # noqa: BLE001 — 失敗したら前回のファイルを残して終わる
        sys.exit(f"取得に失敗しました（{e}）。{OUTPUT.name} は前回の内容のまま変わっていません。")
    empty = [f["properties"]["name"] for f in features if not f["geometry"]["coordinates"]]
    if empty:
        sys.exit(f"形を取り出せなかった建物があります：{'、'.join(empty)}。{OUTPUT.name} は変更していません。")

    OUTPUT.write_text(
        json.dumps({
            "type": "FeatureCollection",
            "attribution": "© OpenStreetMap contributors (ODbL)",
            "features": features,
        }, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"保存しました: {OUTPUT.relative_to(ROOT)}（{len(features)}棟）")
    for f in features:
        print("  " + f["properties"]["name"])


if __name__ == "__main__":
    main()
