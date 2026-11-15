#!/usr/bin/env python3
"""Extrae los settings de TheSession del volcado completo a NDJSON.

**Por qué existe.** La tonalidad no es de la tune: es de cada setting ABC. El
volcado completo de TheSession ya trae una fila por setting, así que los
settings se pueblan de aquí **para las tunes que ya existen en `pr_tunes`** (hoy
5.726 de 478 tunes); el volcado entero (55.774) no entra en Supabase ni se sirve
al navegador —el artefacto del catálogo sigue pesando 4,92 MB—, y una tune nueva
se resuelve granular contra la API. Nada de llamadas masivas.

**De dónde se baja.** El `thesession.db` del repo `adactio/TheSession-data`
(147 MB, Git LFS):

    https://media.githubusercontent.com/media/adactio/TheSession-data/main/thesession.db

El `csv/` del mismo repo NO trae settings; el `.db` sí. Se verifica contra el
sha256 del puntero que versiona el repo antes de usarlo (el `size` del puntero
también sirve: 146.944.000 bytes).

**Qué tiene dentro, medido el 2026-11-15.** 55.791 filas de `tunes` = una por
setting, de 23.305 tunes, todas con ABC. `mode` es un vocabulario cerrado de 23
tonalidades. Cubre el 99,2 % del catálogo del proyecto.

**Trampas que este script resuelve.**

- `tune_id` es TEXT en el volcado: compararlo con entero da 0 % de intersección
  y se lee como «no hay datos».
- Hay 17 `setting_id` repetidos exactos: se deduplica por `(tune_id, setting_id)`
  y se avisa si el mismo id llega con ABC distinto (eso sí sería un conflicto).
- El ABC viene **sin cabeceras**: el `K:` del texto no es la tonalidad del
  setting. La única fuente es `mode`.

Uso:

    python3 scripts/extract-thesession-settings.py \\
        --db ~/.cache/thesession/thesession.db --out settings.ndjson \\
        --tune 1,12,4521

Para la carga de las tunes que ya están en Supabase, `--tune` lleva la lista de
`origin_ref` de `pr_tunes` (478 hoy). Sin `--tune` emite el volcado entero, que
solo sirve para medir, no para cargar.

Salida: una línea JSON por setting, con `origin_ref` (id de TheSession como
texto, que es lo que guarda `pr_tunes.origin_ref`), `setting_id`, `key`,
`published_on`, `member`, `composer` y `abc`. El informe va por stderr para que
el NDJSON se pueda encadenar.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import NoReturn

# El vocabulario cerrado que publica TheSession (selector de búsqueda). No es una
# suposición: se comprobó contra las 55.791 filas del volcado y contra su UI.
THE_SESSION_KEYS = (
    "Amajor", "Aminor", "Adorian", "Amixolydian", "Bminor", "Cmajor", "Dmajor",
    "Dminor", "Eminor", "Fmajor", "Gmajor", "Dmixolydian", "Bmixolydian",
    "Edorian", "Gdorian", "Gminor", "Ddorian", "Cdorian", "Fdorian",
    "Gmixolydian", "Emajor", "Bdorian", "Emixolydian",
)

SQLITE_MAGIC = b"SQLite format 3\x00"


def fail(message: str) -> NoReturn:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(2)


def open_dump(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        fail(f"no existe el volcado: {path}")
    with path.open("rb") as handle:
        if handle.read(16) != SQLITE_MAGIC:
            fail(f"{path} no es un SQLite (¿un puntero de Git LFS sin descargar?)")
    # Modo lectura: el volcado es un artefacto ajeno y no se toca.
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def check_schema(con: sqlite3.Connection) -> None:
    columns = {row[1] for row in con.execute("pragma table_info(tunes)")}
    missing = {"tune_id", "setting_id", "mode", "abc"} - columns
    if missing:
        fail(f"el volcado no parece el completo: faltan columnas {sorted(missing)}")


def setting_rows(con: sqlite3.Connection, only: set[str] | None):
    sql = (
        "select tune_id, setting_id, mode, abc, date, username, composer "
        "from tunes order by tune_id, setting_id"
    )
    for tune_id, setting_id, mode, abc, date, username, composer in con.execute(sql):
        origin_ref = str(tune_id).strip()
        if only is not None and origin_ref not in only:
            continue
        yield {
            "origin_ref": origin_ref,
            "setting_id": str(setting_id).strip(),
            "key": (mode or "").strip(),
            "published_on": (date or "").strip()[:10] or None,
            "member": (username or "").strip() or None,
            "composer": (composer or "").strip() or None,
            "abc": abc or "",
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--db", required=True, type=Path, help="ruta al thesession.db del volcado")
    parser.add_argument("--out", required=True, type=Path, help="NDJSON de salida")
    parser.add_argument(
        "--tune",
        default="",
        help="lista de origin_ref separada por comas (por defecto, todas)",
    )
    args = parser.parse_args()

    only = {part.strip() for part in args.tune.split(",") if part.strip()} or None
    con = open_dump(args.db)
    check_schema(con)

    seen: dict[tuple[str, str], str] = {}
    duplicates = 0
    conflicts: list[tuple[str, str]] = []
    keys = Counter()
    years = Counter()
    tunes: set[str] = set()
    written = 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as out:
        for row in setting_rows(con, only):
            identity = (row["origin_ref"], row["setting_id"])
            if identity in seen:
                duplicates += 1
                # Mismo id con otro ABC sería un conflicto real, no un duplicado.
                if seen[identity] != row["abc"]:
                    conflicts.append(identity)
                continue
            seen[identity] = row["abc"]
            tunes.add(row["origin_ref"])
            keys[row["key"]] += 1
            if row["published_on"]:
                years[row["published_on"][:4]] += 1
            out.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            written += 1

    unknown = sorted(k for k in keys if k not in THE_SESSION_KEYS)
    print(f"volcado: {args.db}", file=sys.stderr)
    print(f"tunes: {len(tunes):,} · settings escritos: {written:,}", file=sys.stderr)
    print(f"duplicados descartados: {duplicates} · conflictos (id con otro ABC): {len(conflicts)}", file=sys.stderr)
    if conflicts:
        for identity in conflicts[:10]:
            print(f"  conflicto: {identity}", file=sys.stderr)
    print(f"tonalidades: {len(keys)} distintas" + (" · TODAS en el vocabulario" if not unknown else f" · FUERA: {unknown}"), file=sys.stderr)
    span = f"{min(years)}–{max(years)}" if years else "—"
    print(f"años de publicación: {span}", file=sys.stderr)
    print(f"sin abc: {sum(1 for row in seen.values() if not row.strip())}", file=sys.stderr)
    print(f"salida: {args.out}", file=sys.stderr)
    return 0 if not unknown else 1


if __name__ == "__main__":
    raise SystemExit(main())
