#!/usr/bin/env python3
"""Ensayo REAL del marcado de /practice (#36) con un usuario efímero.

La suite del repo prueba la vista con dobles de Supabase; esto prueba el camino
de datos que la vista recorre, con la RLS y los triggers de verdad:

  · la sesión perezosa: insert de `pr_sessions` sin cuerpo,
  · que la línea de `pr_session_tunes` mueve `last_practiced_at` (trigger),
  · que `findTodaySession` (filtro `started_at >= inicio del día` + `ended_at is null`,
    la más reciente) devuelve la sesión de hoy y NO la de septiembre,
  · que un segundo marcado se cuelga de la misma sesión,
  · que reintentar la misma línea choca con el único `(session_id, repertoire_id)`,
  · que desmarcar + `pr_recompute_last_practiced` devuelve `last_practiced_at`
    **exactamente** al valor anterior respaldado por sesión, y a `null` si no queda ninguna,
  · que un repertorio ajeno no admite líneas (RLS con check),
  · y que la anon key sin JWT no ve nada.

Limpia lo que crea: líneas/sesiones/repertorio por el usuario efímero (cascade),
la tune solo si nadie la referencia.

Uso:  python3 verify-practice-marking.py
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

KEYS = "/home/victor/secrets/tradtracker-keys.txt"


def load_keys(path=KEYS):
    keys = {}
    with open(path) as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            keys[name.strip()] = value.strip()
    return keys


KEYS = load_keys()
URL = KEYS["URL"].rstrip("/")
ANON = KEYS["ANON"]
SERVICE = KEYS["SERVICE_ROLE"]


def call(method, path, token, payload=None, apikey=ANON, extra=None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json", "apikey": apikey}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    headers.update(extra or {})
    req = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            body = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            body = raw.decode(errors="replace")
        return exc.code, body


def check(label, condition, detail=""):
    print(f"  [{'OK ' if condition else 'FALLA'}] {label}{(' — ' + detail) if detail else ''}")
    return 0 if condition else 1


def day_start_iso():
    """Inicio del día LOCAL, la misma frontera que usa `startOfLocalDay`."""
    now = datetime.now().astimezone()
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


failures = 0
stamp = str(int(time.time()))
email = f"e2e-practice-{stamp}@example.invalid"
password = "E2e-" + stamp + "-tradtracker"
user_id = rep_a = rep_b = None
tune_ids = []

SEPTEMBER = "2026-09-01T10:00:00+00:00"

try:
    status, body = call("POST", "/auth/v1/admin/users", SERVICE,
                        {"email": email, "password": password, "email_confirm": True}, apikey=SERVICE)
    if status not in (200, 201):
        sys.exit(f"No se pudo crear el usuario efímero: {status} {body}")
    user_id = body["id"]
    print(f"usuario efímero: {user_id}")

    status, session = call("POST", "/auth/v1/token?grant_type=password", None,
                           {"email": email, "password": password})
    if status != 200:
        sys.exit(f"Login fallido: {status} {session}")
    jwt = session["access_token"]

    # Dos filas: A con historial de septiembre, B virgen.
    # `pr_repertoire` es única por (user_id, tune_id): cada fila necesita su tune.
    reps, tune_ids = {}, []
    for label in ("A", "B"):
        status, tune = call("POST", "/rest/v1/pr_tunes", jwt,
                            {"origin": "thesession", "origin_ref": f"e2e-{label}-{stamp}",
                             "name": f"E2E practice {label} {stamp}", "created_by": user_id},
                            extra={"Prefer": "return=representation"})
        if status not in (200, 201):
            sys.exit(f"Alta de pr_tunes {label} fallida: {status} {tune}")
        tune_ids.append(tune[0]["id"])

        status, rep = call("POST", "/rest/v1/pr_repertoire", jwt,
                           {"tune_id": tune[0]["id"], "status": "learning"},
                           extra={"Prefer": "return=representation"})
        if status not in (200, 201):
            sys.exit(f"Alta de repertorio {label} fallida: {status} {rep}")
        reps[label] = rep[0]["id"]
    rep_a, rep_b = reps["A"], reps["B"]
    print(f"repertorio: A={rep_a} B={rep_b}")

    # Historial de septiembre para A: una sesión retroactiva con su línea.
    status, old = call("POST", "/rest/v1/pr_sessions", jwt, {"started_at": SEPTEMBER},
                       extra={"Prefer": "return=representation"})
    old_session = old[0]["id"] if status in (200, 201) else None
    call("POST", "/rest/v1/pr_session_tunes", jwt,
         {"session_id": old_session, "repertoire_id": rep_a, "position": 0},
         extra={"Prefer": "return=minimal"})

    status, rows = call("GET", f"/rest/v1/pr_repertoire?id=eq.{rep_a}&select=last_practiced_at", jwt)
    antes = (rows or [{}])[0].get("last_practiced_at")
    print("\nEscenario previo:")
    failures += check("la fecha anterior queda en septiembre", antes is not None and antes.startswith("2026-09-01"),
                      str(antes))

    # ── 1. Sesión perezosa: insert sin cuerpo, como hace createSessionWithMarks ──
    print("\nSesión y marcado de hoy:")
    status, sess = call("POST", "/rest/v1/pr_sessions", jwt, {},
                        extra={"Prefer": "return=representation"})
    today_session = sess[0]["id"] if status in (200, 201) else None
    failures += check("alta de sesión sin cuerpo responde 201", status in (200, 201), f"{status} {sess}")

    status, line = call("POST", "/rest/v1/pr_session_tunes", jwt,
                        {"session_id": today_session, "repertoire_id": rep_a,
                         "quality": None, "position": 0},
                        extra={"Prefer": "return=representation"})
    failures += check("línea de sesión con quality null", status in (200, 201), f"{status} {line}")

    status, rows = call("GET", f"/rest/v1/pr_repertoire?id=eq.{rep_a}&select=last_practiced_at", jwt)
    hoy = (rows or [{}])[0].get("last_practiced_at")
    failures += check("el trigger adelanta la fecha a hoy", hoy != antes and hoy is not None,
                      f"{antes} -> {hoy}")

    # ── 2. findTodaySession: la de hoy sí, la de septiembre no ──
    print("\nfindTodaySession (filtros reales):")
    status, found = call(
        "GET",
        "/rest/v1/pr_sessions?select=id,started_at,ended_at,pr_session_tunes(repertoire_id)"
        f"&started_at=gte.{urllib.parse.quote(day_start_iso())}&ended_at=is.null"
        "&order=started_at.desc&limit=1",
        jwt,
    )
    ok = status == 200 and isinstance(found, list) and len(found) == 1
    failures += check("encuentra exactamente una sesión de hoy", ok, f"{status} {found}")
    if ok:
        failures += check("es la sesión recién abierta", found[0]["id"] == today_session, found[0]["id"])
        marcadas = [t["repertoire_id"] for t in (found[0].get("pr_session_tunes") or [])]
        failures += check("trae su marca", rep_a in marcadas, str(marcadas))
        failures += check("no es la sesión de septiembre", found[0]["id"] != old_session, "")

    # ── 3. Segundo marcado: misma sesión; repetir choca con el único ──
    print("\nIdempotencia de la marca:")
    status, _ = call("POST", "/rest/v1/pr_session_tunes", jwt,
                     {"session_id": today_session, "repertoire_id": rep_b, "position": 1},
                     extra={"Prefer": "return=minimal"})
    failures += check("segunda marca en la misma sesión", status in (200, 201), str(status))

    status, body = call("POST", "/rest/v1/pr_session_tunes", jwt,
                        {"session_id": today_session, "repertoire_id": rep_a, "position": 0},
                        extra={"Prefer": "return=minimal"})
    failures += check("repetir la misma marca choca con el único (23505)",
                      status >= 400 and "23505" in json.dumps(body), f"{status} {body}")

    status, sessions = call("GET", f"/rest/v1/pr_sessions?select=id&started_at=gte."
                                   f"{urllib.parse.quote(day_start_iso())}", jwt)
    failures += check("no se ha abierto una segunda sesión", len(sessions or []) == 1, str(sessions))

    # ── 4. Desmarcar: la fecha vuelve EXACTAMENTE a septiembre ──
    print("\nDesmarcar (borrado + recalculo):")
    status, _ = call("DELETE",
                     f"/rest/v1/pr_session_tunes?session_id=eq.{today_session}&repertoire_id=eq.{rep_a}",
                     jwt, extra={"Prefer": "return=minimal"})
    failures += check("borrado de la línea responde 204", status == 204, str(status))

    status, rows = call("GET", f"/rest/v1/pr_repertoire?id=eq.{rep_a}&select=last_practiced_at", jwt)
    sin_recalcular = (rows or [{}])[0].get("last_practiced_at")
    failures += check("tras borrar, la fecha sigue en hoy (hace falta el recálculo)",
                      sin_recalcular == hoy, f"{hoy} -> {sin_recalcular}")

    status, value = call("POST", "/rest/v1/rpc/pr_recompute_last_practiced", jwt,
                         {"p_repertoire_id": rep_a})
    status2, rows = call("GET", f"/rest/v1/pr_repertoire?id=eq.{rep_a}&select=last_practiced_at", jwt)
    despues = (rows or [{}])[0].get("last_practiced_at")
    failures += check("el recálculo responde 200", status == 200, f"{status} {value}")
    failures += check("la fecha vuelve EXACTAMENTE a septiembre", despues == antes, f"{despues} vs {antes}")

    # ── 5. Desmarcar la última: null ──
    status, _ = call("DELETE",
                     f"/rest/v1/pr_session_tunes?session_id=eq.{old_session}&repertoire_id=eq.{rep_a}",
                     jwt, extra={"Prefer": "return=minimal"})
    call("POST", "/rest/v1/rpc/pr_recompute_last_practiced", jwt, {"p_repertoire_id": rep_a})
    status, rows = call("GET", f"/rest/v1/pr_repertoire?id=eq.{rep_a}&select=last_practiced_at", jwt)
    failures += check("sin sesiones restantes, la fecha queda en null",
                      (rows or [{}])[0].get("last_practiced_at") is None, str(rows))

    # ── 6. RLS: no se puede marcar una fila de repertorio ajena ──
    print("\nRLS:")
    status, anon_rows = call(
        "GET", f"/rest/v1/pr_session_tunes?select=id&session_id=eq.{today_session}", None)
    failures += check("anon sin JWT no ve las líneas", anon_rows == [], str(anon_rows))

    status, body = call("POST", "/rest/v1/pr_session_tunes", jwt,
                        {"session_id": today_session,
                         "repertoire_id": "00000000-0000-0000-0000-000000000000",
                         "position": 0},
                        extra={"Prefer": "return=minimal"})
    failures += check("una fila de repertorio ajena no admite línea", status >= 400, f"{status} {body}")

    status, value = call("POST", "/rest/v1/rpc/pr_recompute_last_practiced", jwt,
                         {"p_repertoire_id": "00000000-0000-0000-0000-000000000000"})
    failures += check("recalcular una fila ajena: 200 y null, sin oráculo",
                      status == 200 and value is None, f"{status} {value}")

finally:
    print("\nLimpieza:")
    if user_id:
        status, _ = call("DELETE", f"/auth/v1/admin/users/{user_id}", SERVICE, apikey=SERVICE)
        print(f"  usuario {user_id} (cascade de sesiones y repertorio): {status}")
    for tune in tune_ids:
        status, refs = call("GET", f"/rest/v1/pr_repertoire?tune_id=eq.{tune}&select=id",
                            SERVICE, apikey=SERVICE)
        if refs:
            print(f"  AVISO: la tune {tune} aún tiene {len(refs)} referencias; NO se borra")
        else:
            status, _ = call("DELETE", f"/rest/v1/pr_tunes?id=eq.{tune}", SERVICE, apikey=SERVICE)
            print(f"  tune {tune}: {status}")

print(f"\nRESULTADO: {'TODO OK' if failures == 0 else str(failures) + ' COMPROBACIONES FALLIDAS'}")
sys.exit(0 if failures == 0 else 1)
