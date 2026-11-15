#!/usr/bin/env python3
"""Carga en Supabase las tonalidades de los settings de las tunes que ya existen.

**Qué carga y qué no.** Solo las filas de `pr_tune_settings` —`tune_id`,
`setting_ref`, `key`— de las tunes presentes en `pr_tunes`. El ABC no se carga: el
dock lo trae de la API al abrir la ficha (#59). El volcado entero (55.774 filas)
no entra: para las 478 tunes del repertorio son 5.726.

Uso:

    python3 scripts/load-thesession-settings.py --ndjson settings.ndjson
    python3 scripts/load-thesession-settings.py --ndjson settings.ndjson --dry-run

El NDJSON sale de `scripts/extract-thesession-settings.py` (sin `--tune`: el
filtro lo hace este script contra `pr_tunes`, que es la fuente de verdad de qué
tunes existen).

Credenciales: `~/secrets/tradtracker-keys.txt` (`URL`, `SERVICE_ROLE`). Con
`service_role` la escritura no pasa por RLS; el `insert` es idempotente por la
clave `(tune_id, setting_ref)`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import NoReturn


def fail(message: str) -> NoReturn:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(2)


def credentials() -> tuple[str, str]:
    path = Path(os.path.expanduser("~/secrets/tradtracker-keys.txt"))
    if not path.is_file():
        fail(f"faltan las claves del proyecto: {path}")
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


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--ndjson", required=True, type=Path)
    parser.add_argument("--batch", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

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
    print(f"pr_tunes: {len(tunes)} filas · {len(by_ref)} con origin_ref", file=sys.stderr)

    rows, seen, missing = [], set(), set()
    for line in args.ndjson.open(encoding="utf-8"):
        row = json.loads(line)
        ref = row["origin_ref"]
        tune_id = by_ref.get(ref)
        if tune_id is None:
            missing.add(ref)
            continue
        identity = (tune_id, row["setting_id"])
        if identity in seen:
            continue
        seen.add(identity)
        rows.append({
            "tune_id": tune_id,
            "setting_ref": row["setting_id"],
            "key": row["key"],
            "key_raw": None,
        })

    print(f"filas a cargar: {len(rows):,} · origin_ref fuera de pr_tunes: {len(missing):,}", file=sys.stderr)
    print("  (normal: el NDJSON es el volcado entero; solo se cargan las tunes que existen)", file=sys.stderr)
    if args.dry_run:
        if rows:
            print(f"  primera: {rows[0]}", file=sys.stderr)
        return 0

    loaded = 0
    for start in range(0, len(rows), args.batch):
        chunk = rows[start:start + args.batch]
        status, body = request(
            f"{url}/rest/v1/pr_tune_settings?on_conflict=tune_id,setting_ref",
            service,
            method="POST",
            body=chunk,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        if status not in (200, 201, 204):
            fail(f"tanda {start}-{start + len(chunk)}: {status} {body}")
        loaded += len(chunk)
        print(f"  cargadas {loaded:,}/{len(rows):,}", file=sys.stderr)
    print(f"hecho: {loaded:,} filas en pr_tune_settings", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
