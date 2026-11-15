#!/usr/bin/env python3
"""Precalcula la afinidad entre las tunes del repertorio y la carga en Supabase.

**De dónde sale la señal.** Del volcado completo de TheSession: `sets` (tunes que
la gente toca juntas) y `recordings` (tunes que comparten disco). No de un hash
melódico: se midió y no discriminaba (n-gramas de intervalos, mediana 0,048).

**Qué escribe.** `pr_tune_affinity`, con los dos sentidos de cada par y el top-10
por tune. `score = 3*sets + recordings`. Solo para tunes presentes en `pr_tunes`.

Uso:

    python3 scripts/load-thesession-affinity.py --db ~/.cache/thesession/thesession.db
    python3 scripts/load-thesession-affinity.py --db … --dry-run

Credenciales: `~/secrets/tradtracker-keys.txt` (`URL`, `SERVICE_ROLE`). La carga
va con `service_role` y es idempotente por la clave `(tune_id, related_tune_id)`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import NoReturn

TOP = 10
SET_WEIGHT = 3


def fail(message: str) -> NoReturn:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(2)


def credentials() -> tuple[str, str]:
    path = Path(os.path.expanduser("~/secrets/tradtracker-keys.txt"))
    values = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.strip().split("=", 1)
            values[key] = value
    if "URL" not in values or "SERVICE_ROLE" not in values:
        fail("el fichero de claves no trae URL y SERVICE_ROLE")
    return values["URL"].rstrip("/"), values["SERVICE_ROLE"]


def request(url: str, service: str, method="GET", body=None, prefer=None):
    headers = {
        "apikey": service,
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()[:400]


def pairs_by_group(con, sql, wanted):
    groups: dict[str, list[str]] = {}
    for group_id, tune_ref in con.execute(sql):
        ref = str(tune_ref).strip()
        if ref in wanted:
            groups.setdefault(str(group_id), []).append(ref)
    pairs: Counter = Counter()
    for refs in groups.values():
        refs = sorted(set(refs))
        for i, a in enumerate(refs):
            for b in refs[i + 1:]:
                pairs[(a, b)] += 1
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--batch", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.db.is_file():
        fail(f"no existe el volcado: {args.db}")

    import sqlite3
    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    url, service = credentials()

    tunes: list[dict] = []
    offset = 0
    while True:
        status, chunk = request(
            f"{url}/rest/v1/pr_tunes?select=id,origin_ref&order=id&limit=1000&offset={offset}",
            service,
        )
        if status != 200 or not isinstance(chunk, list):
            fail(f"no se pudo leer pr_tunes: {status} {chunk}")
        tunes.extend(chunk)
        if len(chunk) < 1000:
            break
        offset += 1000
    by_ref = {row["origin_ref"]: row["id"] for row in tunes if row.get("origin_ref")}
    wanted = set(by_ref)
    print(f"pr_tunes: {len(by_ref)} con origin_ref", file=sys.stderr)

    sets = pairs_by_group(con, "select tuneset, tune_id from sets", wanted)
    recs = pairs_by_group(con, "select recording, tune_id from recordings", wanted)
    print(f"pares en sets: {len(sets):,} · en grabaciones: {len(recs):,}", file=sys.stderr)

    best: dict[str, list[tuple[int, str]]] = {}
    for (a, b), n in sets.items():
        best.setdefault(a, []).append((SET_WEIGHT * n + recs.get((a, b), 0), b))
        best.setdefault(b, []).append((SET_WEIGHT * n + recs.get((a, b), 0), a))
    # Un par que solo comparte grabación no entra por sets: se añade aparte.
    for (a, b), n in recs.items():
        if (a, b) in sets:
            continue
        best.setdefault(a, []).append((n, b))
        best.setdefault(b, []).append((n, a))

    rows = []
    for ref, scored in best.items():
        for score, other in sorted(scored, reverse=True)[:TOP]:
            # Los contadores se guardan con el par ordenado (a<b): buscarlos con
            # el par tal cual dejaba el sentido inverso a cero.
            pair = (ref, other) if ref < other else (other, ref)
            rows.append({
                "tune_id": by_ref[ref],
                "related_tune_id": by_ref[other],
                "sets": sets.get(pair, 0),
                "recordings": recs.get(pair, 0),
            })
    print(f"filas a cargar: {len(rows):,} (top-{TOP} por sense, {len(best)} tunes con afinidad)", file=sys.stderr)
    if args.dry_run:
        print(f"  primera: {rows[0]}", file=sys.stderr)
        return 0

    loaded = 0
    for start in range(0, len(rows), args.batch):
        chunk = rows[start:start + args.batch]
        status, body = request(
            f"{url}/rest/v1/pr_tune_affinity?on_conflict=tune_id,related_tune_id",
            service,
            method="POST",
            body=chunk,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        if status not in (200, 201, 204):
            fail(f"tanda {start}-{start + len(chunk)}: {status} {body}")
        loaded += len(chunk)
    print(f"hecho: {loaded:,} filas en pr_tune_affinity", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
