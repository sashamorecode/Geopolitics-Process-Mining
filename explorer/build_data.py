"""Build the Explorer's static per-country event indexes from the original releases."""

import argparse
import csv
import json
from collections import defaultdict
from datetime import date
from functools import lru_cache
from io import TextIOWrapper
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
EPOCH = date(1970, 1, 1)
ACTIONS = [
    "Make public statement", "Appeal", "Express intent to cooperate", "Consult",
    "Engage in diplomatic cooperation", "Engage in material cooperation", "Provide aid",
    "Yield", "Investigate", "Demand", "Disapprove", "Reject", "Threaten", "Protest",
    "Exhibit force posture", "Reduce relations", "Coerce", "Assault", "Fight",
    "Use unconventional mass violence",
]
HISTORICAL = {
    "CSK": "Czechoslovakia", "DDR": "East Germany", "KSV": "Kosovo",
    "SCG": "Serbia and Montenegro", "SUN": "Soviet Union", "TMP": "East Timor",
    "YUG": "Yugoslavia", "ANT": "Netherlands Antilles",
}
ICEWS_ALIASES = {
    "Turkey": "TUR", "Occupied Palestinian Territory": "PSE",
    "Democratic Republic of Congo": "COD", "Kosovo": "KSV", "Holy See": "VAT",
    "the former Yugoslav Republic of Macedonia": "MKD", "Cote d'Ivoire": "CIV",
    "Swaziland": "SWZ", "Brunei": "BRN", "Cape Verde": "CPV", "Cook Island": "COK",
    "Falkland Islands": "FLK", "U.S. Virgin Islands": "VIR", "Micronesia": "FSM",
    "Saint Helena": "SHN", "Netherlands Antilles": "ANT", "Sint Maarten": "SXM",
}


def country_names(iso_file):
    labels = dict(HISTORICAL)
    aliases = dict(ICEWS_ALIASES)
    for country in json.loads(iso_file.read_text())["3166-1"]:
        code = country["alpha_3"]
        labels[code] = country.get("common_name", country["name"])
        for key in ("name", "common_name", "official_name"):
            if key in country:
                aliases[country[key]] = code
    return labels, {name.casefold(): code for name, code in aliases.items()}


@lru_cache(maxsize=20000)
def phoenix_date(value):
    month, day, year = map(int, value.split("/"))
    return date(year, month, day)


def phoenix_records(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            yield row["source_root"], row["target_root"], phoenix_date(row["story_date"]), int(row["root_code"]), row["aid"]


def icews_records(directory, aliases):
    for year in range(1995, 2000):
        path, = directory.glob(f"events.{year}.*.tab.zip")
        with ZipFile(path) as archive:
            member, = archive.namelist()
            with archive.open(member) as stream, TextIOWrapper(stream, encoding="utf-8-sig", newline="") as f:
                for row in csv.DictReader(f, delimiter="\t"):
                    source = aliases.get(row["Source Country"].casefold())
                    target = aliases.get(row["Target Country"].casefold())
                    yield source, target, date.fromisoformat(row["Event Date"]), int(row["CAMEO Code"][:2]), (row["Publisher"], row["Story ID"])


def phoenix_articles(path, needed):
    articles = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row["aid"] in needed:
                articles[row["aid"]] = [row["title"], row["url"]]
    return articles


def build_dataset(folder, records, labels, info, metadata=None):
    pairs = defaultdict(list)
    countries = set()
    first_year, last_year = 9999, 0
    for source, target, when, action, story in records:
        if source == target or source not in labels or target not in labels:
            continue
        if not 1 <= action <= len(ACTIONS):
            raise ValueError(f"Unsupported CAMEO action {action}")
        pairs[source + target].append(((when - EPOCH).days * 32 + action, story))
        countries.update((source, target))
        first_year, last_year = min(first_year, when.year), max(last_year, when.year)

    destination = folder / info["id"]
    destination.mkdir(parents=True, exist_ok=True)
    sources = destination / "sources"
    sources.mkdir(exist_ok=True)
    needed = {story for values in pairs.values() for _, story in values} if metadata else set()
    articles = phoenix_articles(metadata, needed) if metadata else {}
    event_files = defaultdict(dict)
    source_files = defaultdict(list)
    for pair, events in sorted(pairs.items()):
        # The original index breaks ties for both the graph and its evidence.
        events.sort(key=lambda event: event[0] // 32)
        event_files[pair[0]][pair] = [value for value, _ in events]
        # Sixty-four buckets spread high-volume countries across on-demand downloads.
        bucket = sum((i + 1) * ord(char) for i, char in enumerate(pair)) % 64
        source_files[bucket].append(pair)
    for initial in sorted({country[0] for country in countries}):
        entries = [f'  "{pair}":' + json.dumps(values, separators=(",", ":"))
                   for pair, values in event_files[initial].items()]
        (destination / f"{initial}.json").write_text("{\n" + ",\n".join(entries) + "\n}\n")
    for bucket, members in source_files.items():
        story_ids = {}
        refs = {pair: [story_ids.setdefault(story, len(story_ids)) for _, story in pairs[pair]]
                for pair in members}
        stories = [articles.get(story) if metadata else story for story in story_ids]
        (sources / f"{bucket}.json").write_text(json.dumps(
            {"stories": stories, "pairs": refs}, separators=(",", ":"), ensure_ascii=False))
    events = sum(map(len, pairs.values()))
    print(f"{info['id']}: {events:,} events, {len(pairs):,} directed pairs", flush=True)
    return dict(info, minYear=first_year, maxYear=last_year, eventCount=events,
                countries=[{"code": code, "name": labels[code]}
                           for code in sorted(countries, key=labels.get)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iso", type=Path, default=Path("/usr/share/iso-codes/json/iso_3166-1.json"))
    parser.add_argument("--raw", type=Path, default=ROOT.parent / "data")
    parser.add_argument("--out", type=Path, default=ROOT / "dist/data")
    args = parser.parse_args()
    labels, aliases = country_names(args.iso)
    phoenix = build_dataset(args.out, phoenix_records(args.raw / "PhoenixBLN-NYT_1980-2018.csv"), labels, {
        "id": "phoenix", "name": "Phoenix · New York Times", "defaultSource": "USA", "defaultTarget": "DEU",
        "description": "Cline Center Historical Phoenix v1.3.0, New York Times corpus. Althaus et al. (2020), CC BY 4.0.",
        "sourceUrl": "https://doi.org/10.13012/B2IDB-0647142_V3",
    }, metadata=args.raw / "MetaDataBLN-NYT_1980-2018.csv")
    icews = build_dataset(args.out, icews_records(args.raw / "icews", aliases), labels, {
        "id": "icews", "name": "ICEWS · Coded Events", "defaultSource": "USA", "defaultTarget": "DEU",
        "description": "ICEWS Coded Event Data, 1995–1999 annual files. Boschee et al. (2015), Harvard Dataverse.",
        "sourceUrl": "https://doi.org/10.7910/DVN/28075",
    })
    catalog = {"datasets": [phoenix, icews],
               "actions": [{"id": i, "name": name} for i, name in enumerate(ACTIONS, 1)]}
    (args.out / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
