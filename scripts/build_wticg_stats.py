#!/usr/bin/env python3
"""Build assets/data/wticg-stats.json for the community map.

Cross-references the WTICG papers (Workshop de Trabalhos de Iniciação Científica
e de Graduação) from scripts/sbseg_data.json (extended proceedings sections) with
the SBSeg host-city geo in assets/data/sbseg-editions.json, so the community map
can show a WTICG overlay (one pin per host city, sized by paper count) plus an
overall statistics panel.

Only the main WTICG section is counted; the separate "... em Andamento" (works in
progress) workshop is intentionally excluded to match the WTICG proper.

Run from the repo root:  python3 scripts/build_wticg_stats.py
"""
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "sbseg_data.json")
GEO = os.path.join(ROOT, "assets", "data", "sbseg-editions.json")
OUT = os.path.join(ROOT, "assets", "data", "wticg-stats.json")

WTICG_NAME = "Workshop de Trabalhos de Iniciação Científica e de Graduação"


def fold(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()


def is_wticg(title):
    """True only for the main WTICG, not the 'em Andamento' variant."""
    t = fold(title)
    return t == fold(WTICG_NAME)


def split_authors(s):
    parts = re.split(r"[;,]| e ", s or "")
    return [p.strip() for p in parts if p.strip()]


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    geo = json.load(open(GEO, encoding="utf-8"))

    year2geo = {}
    for c in geo.get("cities", []):
        for e in c.get("editions", []):
            year2geo[e["year"]] = {
                "city": c["city"], "uf": c.get("uf"),
                "lat": c.get("lat"), "lng": c.get("lng"),
            }

    per_year = []
    author_counts = {}
    cities = {}  # key: city name -> aggregated record
    total = 0

    for ed in data.get("estendido", []):
        year = int(ed.get("year"))
        edition_url = ed.get("url")
        papers = []
        for sec in ed.get("sections", []):
            if is_wticg(sec.get("section", "")):
                papers.extend(sec.get("papers", []))
        if not papers:
            continue
        total += len(papers)
        for p in papers:
            for a in split_authors(p.get("authors", "")):
                author_counts[a] = author_counts.get(a, 0) + 1

        g = year2geo.get(year, {})
        per_year.append({
            "year": year, "n": len(papers),
            "city": g.get("city"), "uf": g.get("uf"), "url": edition_url,
        })

        if g.get("lat") is not None:
            key = g["city"]
            c = cities.setdefault(key, {
                "city": g["city"], "uf": g["uf"],
                "lat": g["lat"], "lng": g["lng"], "total": 0, "editions": [],
            })
            c["total"] += len(papers)
            c["editions"].append({
                "year": year, "n": len(papers), "url": edition_url,
                "papers": [
                    {"title": p.get("title"), "authors": p.get("authors"), "url": p.get("url")}
                    for p in papers
                ],
            })

    per_year.sort(key=lambda x: x["year"])
    years = [e["year"] for e in per_year]
    top_authors = sorted(author_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    top_authors = [{"name": n, "n": c} for n, c in top_authors if c >= 2][:20]

    city_list = sorted(cities.values(), key=lambda c: -c["total"])
    for c in city_list:
        c["editions"].sort(key=lambda e: e["year"])

    out = {
        "workshop": "WTICG",
        "name": WTICG_NAME,
        "note": ("Papers do Workshop de Trabalhos de Iniciação Científica e de "
                 "Graduação (WTICG) por edição do SBSeg. Gerado por "
                 "scripts/build_wticg_stats.py a partir de scripts/sbseg_data.json "
                 "e assets/data/sbseg-editions.json. Não inclui o WTICG em Andamento."),
        "anais_page": "anais-estendidos.html",
        "total_papers": total,
        "n_editions": len(per_year),
        "editions_covered": years,
        "distinct_authors": len(author_counts),
        "per_year": per_year,
        "top_authors": top_authors,
        "cities": city_list,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("wrote", OUT)
    print(f"  total papers: {total} | editions: {len(per_year)} | "
          f"cities: {len(city_list)} | distinct authors: {len(author_counts)}")


if __name__ == "__main__":
    main()
