#!/usr/bin/env python3
"""Build assets/data/wticg-stats.json for the community map, mapped by the
authors' INSTITUTIONS (not by the SBSeg host city).

For every WTICG paper (Workshop de Trabalhos de Iniciação Científica e de
Graduação) the authors and their affiliations are read from the paper's SOL page
(OJS `citation_author` / `citation_author_institution` meta tags), cached under
scripts/wticg_cache/<id>.html by scripts/fetch_wticg_pages.sh. A paper is counted
once per distinct institution among its co-authors, so a paper with authors from
two institutions appears at both.

Run from the repo root:  python3 scripts/build_wticg_stats.py
(Download the pages first: bash scripts/fetch_wticg_pages.sh)
"""
import html
import json
import os
import re
import unicodedata
from collections import Counter, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "sbseg_data.json")
CACHE = os.path.join(ROOT, "scripts", "wticg_cache")
OUT = os.path.join(ROOT, "assets", "data", "wticg-stats.json")

WTICG_NAME = "Workshop de Trabalhos de Iniciação Científica e de Graduação"

META_RE = re.compile(
    r'<meta name="(citation_author|citation_author_institution)"\s+content="([^"]*)"',
    re.I)


def fold(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()


# Canonical institution -> geo (main campus / headquarters city centroid).
GEO = {
    "UNICAMP":     ("Universidade Estadual de Campinas", "Campinas", "SP", -22.8172, -47.0694),
    "USP":         ("Universidade de São Paulo", "São Paulo", "SP", -23.5595, -46.7313),
    "UFPA":        ("Universidade Federal do Pará", "Belém", "PA", -1.4744, -48.4526),
    "UFU":         ("Universidade Federal de Uberlândia", "Uberlândia", "MG", -18.9186, -48.2570),
    "PUCPR":       ("Pontifícia Universidade Católica do Paraná", "Curitiba", "PR", -25.4506, -49.2300),
    "CEFET-RJ":    ("CEFET/RJ", "Rio de Janeiro", "RJ", -22.9128, -43.2246),
    "UFRN":        ("Universidade Federal do Rio Grande do Norte", "Natal", "RN", -5.8433, -35.1997),
    "UFPR":        ("Universidade Federal do Paraná", "Curitiba", "PR", -25.4269, -49.2610),
    "UFRR":        ("Universidade Federal de Roraima", "Boa Vista", "RR", 2.8460, -60.6716),
    "UFAM":        ("Universidade Federal do Amazonas", "Manaus", "AM", -3.0989, -59.9648),
    "UFPB":        ("Universidade Federal da Paraíba", "João Pessoa", "PB", -7.1381, -34.8450),
    "UNIPAMPA":    ("Universidade Federal do Pampa", "Bagé", "RS", -31.3297, -54.1069),
    "UFMG":        ("Universidade Federal de Minas Gerais", "Belo Horizonte", "MG", -19.8703, -43.9647),
    "UNISINOS":    ("Universidade do Vale do Rio dos Sinos", "São Leopoldo", "RS", -29.7939, -51.1531),
    "UFSM":        ("Universidade Federal de Santa Maria", "Santa Maria", "RS", -29.7178, -53.7159),
    "UFF":         ("Universidade Federal Fluminense", "Niterói", "RJ", -22.8969, -43.1266),
    "UFABC":       ("Universidade Federal do ABC", "Santo André", "SP", -23.6440, -46.5286),
    "UFC":         ("Universidade Federal do Ceará", "Fortaleza", "CE", -3.7447, -38.5742),
    "CEFET-MG":    ("CEFET/MG", "Belo Horizonte", "MG", -19.9227, -43.9370),
    "UECE":        ("Universidade Estadual do Ceará", "Fortaleza", "CE", -3.7906, -38.5560),
    "IFC":         ("Instituto Federal Catarinense", "Blumenau", "SC", -26.9194, -49.0661),
    "UFSJ":        ("Universidade Federal de São João del-Rei", "São João del-Rei", "MG", -21.1355, -44.2600),
    "IME":         ("Instituto Militar de Engenharia", "Rio de Janeiro", "RJ", -22.9556, -43.1660),
    "UFSC":        ("Universidade Federal de Santa Catarina", "Florianópolis", "SC", -27.6006, -48.5197),
    "IF Goiano":   ("Instituto Federal Goiano", "Goiânia", "GO", -16.6799, -49.2550),
    "IFSC":        ("Instituto Federal de Santa Catarina", "Florianópolis", "SC", -27.5969, -48.5495),
    "UDESC":       ("Universidade do Estado de Santa Catarina", "Florianópolis", "SC", -27.6011, -48.5185),
    "UnB":         ("Universidade de Brasília", "Brasília", "DF", -15.7657, -47.8721),
    "UFCG":        ("Universidade Federal de Campina Grande", "Campina Grande", "PB", -7.2136, -35.9046),
    "UFRJ":        ("Universidade Federal do Rio de Janeiro", "Rio de Janeiro", "RJ", -22.8626, -43.2236),
    "UNESP":       ("Universidade Estadual Paulista", "São Paulo", "SP", -23.5470, -46.6386),
    "Senac":       ("Senac", "São Paulo", "SP", -23.5280, -46.6700),
    "UTFPR":       ("Universidade Tecnológica Federal do Paraná", "Curitiba", "PR", -25.4390, -49.2700),
    "IFTM":        ("Instituto Federal do Triângulo Mineiro", "Uberaba", "MG", -19.7472, -47.9319),
    "UFSCar":      ("Universidade Federal de São Carlos", "São Carlos", "SP", -21.9840, -47.8810),
    "CESAR School": ("CESAR School", "Recife", "PE", -8.0578, -34.8720),
    "UFPI":        ("Universidade Federal do Piauí", "Teresina", "PI", -5.0560, -42.7960),
    "IFF":         ("Instituto Federal Fluminense", "Campos dos Goytacazes", "RJ", -21.7622, -41.3306),
    "FURB":        ("Universidade Regional de Blumenau", "Blumenau", "SC", -26.9060, -49.0710),
    "ITA":         ("Instituto Tecnológico de Aeronáutica", "São José dos Campos", "SP", -23.2103, -45.8664),
    "PUC-Rio":     ("Pontifícia Universidade Católica do Rio de Janeiro", "Rio de Janeiro", "RJ", -22.9791, -43.2330),
    "UPE":         ("Universidade de Pernambuco", "Recife", "PE", -8.0450, -34.9500),
    "UFRPE":       ("Universidade Federal Rural de Pernambuco", "Recife", "PE", -8.0176, -34.9446),
    "CTI":         ("CTI Renato Archer", "Campinas", "SP", -22.8100, -47.0630),
    "IFSP":        ("Instituto Federal de São Paulo", "São Paulo", "SP", -23.5230, -46.6340),
    "UFG":         ("Universidade Federal de Goiás", "Goiânia", "GO", -16.6030, -49.2660),
    "UNINTER":     ("Centro Universitário Internacional UNINTER", "Curitiba", "PR", -25.4360, -49.2700),
    "IFCE":        ("Instituto Federal do Ceará", "Fortaleza", "CE", -3.7440, -38.5360),
    "IFRN":        ("Instituto Federal do Rio Grande do Norte", "Natal", "RN", -5.8110, -35.2050),
    "IFPR":        ("Instituto Federal do Paraná", "Curitiba", "PR", -25.4290, -49.2700),
    "UFPE":        ("Universidade Federal de Pernambuco", "Recife", "PE", -8.0522, -34.9511),
    "Inmetro":     ("Inmetro", "Duque de Caxias", "RJ", -22.5920, -43.2900),
    "E-Val":       ("E-Val Tecnologia", "São Paulo", "SP", -23.5600, -46.6560),
    # Companies without a clear Brazilian academic campus are left unmapped on
    # purpose (the paper still appears via its academic co-authors).
}

# Folded affiliation string (already split on " / ") -> canonical GEO key.
ALIAS = {
    "unicamp": "UNICAMP", "usp": "USP", "ufpa": "UFPA", "ufu": "UFU",
    "pucpr": "PUCPR", "cefet-rj": "CEFET-RJ", "cefet/rj": "CEFET-RJ",
    "ufrn": "UFRN", "latarc research lab": "UFRN", "latarc": "UFRN",
    "ufpr": "UFPR", "ufrr": "UFRR", "ufam": "UFAM", "ufpb": "UFPB",
    "unipampa": "UNIPAMPA", "ufmg": "UFMG", "unisinos": "UNISINOS",
    "ufsm": "UFSM", "uff": "UFF", "ufabc": "UFABC", "ufc": "UFC",
    "cefet-mg": "CEFET-MG", "uece": "UECE", "ifc": "IFC", "ufsj": "UFSJ",
    "ime": "IME", "ufsc": "UFSC", "if goiano": "IF Goiano", "ifsc": "IFSC",
    "udesc": "UDESC", "unb": "UnB", "ufcg": "UFCG", "ufrj": "UFRJ",
    "unesp": "UNESP", "senac": "Senac", "utfpr": "UTFPR", "iftm": "IFTM",
    "ufscar": "UFSCar", "cesar school": "CESAR School", "cesar": "CESAR School",
    "ufpi": "UFPI", "iff": "IFF", "furb": "FURB", "ita": "ITA",
    "puc rio": "PUC-Rio", "puc-rio": "PUC-Rio", "upe": "UPE", "ufrpe": "UFRPE",
    "cti": "CTI", "ifsp": "IFSP", "ufg": "UFG", "uninter": "UNINTER",
    "ifce": "IFCE", "ifrn": "IFRN", "ifpr": "IFPR", "ufpe": "UFPE",
    "inmetro": "Inmetro", "e-val tecnologia": "E-Val", "e-val": "E-Val",
    "microchip technology": None, "microchip": None,  # company, no BR campus
}


def canon_institutions(raw):
    """Split a raw affiliation string into canonical institution keys."""
    keys = []
    for part in re.split(r"\s+/\s+", raw.strip()):
        f = fold(part)
        if f in ALIAS:
            k = ALIAS[f]
            if k:
                keys.append(k)
        else:
            keys.append(("?", part))  # unmapped, keep original for reporting
    return keys


def parse_authors(fn):
    s = open(fn, encoding="utf-8", errors="replace").read()
    authors = []
    for tag, val in META_RE.findall(s):
        val = html.unescape(val).strip()
        if tag == "citation_author":
            authors.append({"name": val, "insts": []})
        elif authors and val:
            authors[-1]["insts"].append(val)
    return authors


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    # Map SOL view id -> paper meta (year, title, listing authors, url).
    papers = OrderedDict()
    for ed in data.get("estendido", []):
        for sec in ed.get("sections", []):
            if fold(sec.get("section", "")) == fold(WTICG_NAME):
                for p in sec.get("papers", []):
                    m = re.search(r"/view/(\d+)", p.get("url") or "")
                    if m:
                        papers[m.group(1)] = {
                            "year": int(ed["year"]), "title": p.get("title"),
                            "authors": p.get("authors"), "url": p.get("url"),
                        }

    inst_papers = {}          # canonical key -> list of paper dicts
    author_counts = Counter()
    inst_paper_counts = Counter()
    unmapped = Counter()
    per_year = Counter()
    all_authors = set()

    for pid, meta in papers.items():
        fn = os.path.join(CACHE, pid + ".html")
        per_year[meta["year"]] += 1
        keys = set()
        if os.path.exists(fn):
            for a in parse_authors(fn):
                all_authors.add(fold(a["name"]))
                author_counts[a["name"]] += 1
                for raw in a["insts"]:
                    for k in canon_institutions(raw):
                        if isinstance(k, tuple):        # unmapped
                            unmapped[k[1]] += 1
                        else:
                            keys.add(k)
        for k in keys:
            inst_paper_counts[k] += 1
            inst_papers.setdefault(k, []).append({
                "title": meta["title"], "authors": meta["authors"],
                "url": meta["url"], "year": meta["year"],
            })

    institutions = []
    for k, plist in inst_papers.items():
        name, city, uf, lat, lng = GEO[k]
        plist.sort(key=lambda p: (-p["year"], p["title"] or ""))
        institutions.append({
            "key": k, "name": name, "city": city, "uf": uf,
            "lat": lat, "lng": lng, "paper_count": len(plist), "papers": plist,
        })
    institutions.sort(key=lambda c: (-c["paper_count"], c["name"]))

    per_year_list = [{"year": y, "n": per_year[y]} for y in sorted(per_year)]
    top_authors = [{"name": n, "n": c}
                   for n, c in author_counts.most_common() if c >= 2][:20]
    top_institutions = [{"name": i["name"], "key": i["key"], "n": i["paper_count"]}
                        for i in institutions][:15]

    out = {
        "workshop": "WTICG",
        "name": WTICG_NAME,
        "note": ("Trabalhos do WTICG mapeados pelas instituições dos autores "
                 "(um trabalho aparece em cada instituição dos coautores). "
                 "Autores e afiliações extraídos das páginas do SOL/SBC "
                 "(meta citation_author/citation_author_institution). Gerado por "
                 "scripts/build_wticg_stats.py. Não inclui o WTICG em Andamento."),
        "anais_page": "anais-estendidos.html",
        "total_papers": len(papers),
        "n_editions": len(per_year_list),
        "editions_covered": [e["year"] for e in per_year_list],
        "distinct_authors": len(all_authors),
        "distinct_institutions": len(institutions),
        "per_year": per_year_list,
        "top_authors": top_authors,
        "top_institutions": top_institutions,
        "institutions": institutions,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("wrote", OUT)
    print(f"  papers: {len(papers)} | institutions mapped: {len(institutions)} | "
          f"distinct authors: {len(all_authors)}")
    if unmapped:
        print("  UNMAPPED affiliations (excluded from map markers):")
        for a, c in unmapped.most_common():
            print(f"    {c:2d}  {a}")


if __name__ == "__main__":
    main()
