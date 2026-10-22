"""Localhost server for the GIST library room-availability map.

Serves ./static and proxies the library API (https://library.gist.ac.kr:8443).
Logins are made from the page; each one gets a random session token that the page keeps in
sessionStorage, so it lasts for that browser tab only.
"""
import json
import secrets
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
API = "https://library.gist.ac.kr:8443"
FLOORS = (2, 3)


def load_env():
    env = {}
    path = ROOT / ".env"
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


ENV = load_env()


class Library:
    def __init__(self, user_id, password):
        self.user_id = user_id
        self.password = password
        self.token = None
        self.admin_yn = "N"
        self.name = user_id
        self.lock = threading.Lock()

    def _post(self, path, body, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(API + path, json.dumps(body).encode(), headers)
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))["data"]

    def login(self, stale=None):
        with self.lock:
            if self.token and self.token != stale:
                return self.token  # another thread already refreshed it
            data = self._post("/hello/login", {"userId": self.user_id, "userPwd": self.password})
            if not data or not data.get("success"):
                raise LoginError("Wrong ID or password")
            self.token = data["accessToken"]
            account = self._post("/hello/getAccount", {}, self.token)["result"]
            self.admin_yn = account.get("LIBRARIAN_YN2") or "N"
            self.name = account.get("USER_NM") or self.user_id
            return self.token

    def call(self, path, body):
        # An expired or invalid token comes back as HTTP 500, so re-login once and retry.
        token = self.token or self.login()
        try:
            return self._post(path, body, token)
        except urllib.error.HTTPError:
            return self._post(path, body, self.login(stale=token))


class LoginError(Exception):
    pass


SESSIONS = {}  # session token -> logged-in Library


def login(user_id, password):
    lib = Library(user_id, password)
    lib.login()
    token = secrets.token_urlsafe(24)
    SESSIONS[token] = lib
    return token, user_info(lib)


def user_info(lib):
    return {"id": lib.user_id, "name": lib.name}


def add_month(d):
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    for day in (d.day, 30, 29, 28):
        try:
            return d.replace(year=y, month=m, day=day)
        except ValueError:
            pass


def room_hours(room, data):
    """Per-hour status for one room on one day, mirroring the official site's logic."""
    hours = {}
    for rng in data.get("canAvailableRoomDates", []) + data.get("normalRoomGroupDates", []):
        for h in range(rng["FROM_TIME"], rng["TO_TIME"] + 1):
            hours[h] = "free"
    other = {x["RES_HOUR"]: x for x in data.get("roomOther", [])}
    mine = {x["RES_HOUR"] for x in data.get("room", [])}
    tips = {}
    for h in hours:
        if h in mine:
            hours[h] = "mine"
        elif h in other:
            hours[h] = "taken"
        else:
            for na in data.get("notAvailableRoomDates", []):
                to = na["TO_TIME"] or 24
                if na["FROM_TIME"] <= h < to:
                    hours[h] = "blocked"
                    if na.get("REMARK"):
                        tips[h] = na["REMARK"]
                    break
            else:
                if room["ROOM_GROUP"] < 0:
                    hours[h] = "blocked"
    return hours, tips


EARLY = 2  # the library's 00:00–02:00 slots; shown as hours 24–25 of the evening before


def next_day(ymd):
    return (date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:])) + timedelta(days=1)).strftime("%Y%m%d")


def get_day(lib, res_date):
    """Availability for the evening-anchored day `res_date`: its hours 08–23, plus 00–01 of the next
    library date as hours 24–25."""
    today = date.today()
    span = {
        "START_DT_YYYYMMDD": today.strftime("%Y%m%d"),
        "END_DT_YYYYMMDD": add_month(today).strftime("%Y%m%d"),
    }
    info = lib.call("/work/getFacilityInfo", {**span, "RES_YYYYMMDD": res_date})
    i = info["info"]
    rooms = [f for f in info["facility"] if f["FLOOR"] in FLOORS]
    nxt = next_day(res_date)
    dates = [res_date] + ([nxt] if nxt <= i["DATE_END"].replace("-", "") else [])

    def fetch(job):
        room, d = job
        return room, d, lib.call("/work/getRoom", {**span, "ROOM_ID": room["ROOM_ID"], "RES_YYYYMMDD": d})

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch, [(room, d) for d in dates for room in rooms]))

    out = {room["ROOM_ID"]: {"name": room["FAC_NM"], "bookable": room["ROOM_GROUP"] >= 0, "hours": {}, "tips": {}}
           for room in rooms}
    used = {d: 0 for d in dates}
    month_used = 0
    for room, d, data in results:
        hours, tips = room_hours(room, data)
        shift = 0 if d == res_date else 24
        for h, s in hours.items():
            if (h >= EARLY) == (d == res_date):  # same-day hours from res_date, early hours from the next date
                out[room["ROOM_ID"]]["hours"][h + shift] = s
                if h in tips:
                    out[room["ROOM_ID"]]["tips"][h + shift] = tips[h]
        used[d] = data.get("infoCountDay") or used[d]
        if d == res_date:
            month_used = data.get("infoCount") or month_used
    mine = lib.call("/work/getMyReservation", {
        "START_DT": today.replace(day=1).strftime("%Y%m%d"),
        "END_DT": i["DATE_END"].replace("-", ""),
    }) or []
    return {
        "reservations": [
            {"date": m["RES_YYYYMMDD"], "room": m["ROOM_ID"], "hour": m["RES_HOUR"], "resId": m["RES_ID"]}
            for m in mine if m.get("CANCEL_YN") != "Y"
        ],
        "date": res_date,
        "dateStart": i["DATE_START"],
        "dateEnd": i["DATE_END"],
        "dayLeft": max(i["FAC_DUR4"] - used[res_date], 0),
        "dayLeftNext": max(i["FAC_DUR4"] - used[nxt], 0) if nxt in used else 0,  # quota for hours 24–25
        "monthLeft": max(i["FAC_DUR5"] - month_used, 0),
        "rooms": out,
    }


def reserve(lib, room_id, res_date, hours):
    # Hours 24–25 are the next library date's 00:00–02:00.
    booked = []
    for h in sorted(hours):
        d, lh = (next_day(res_date), h - 24) if h >= 24 else (res_date, h)
        rs = lib.call("/work/makeFacilityreservation", {
            "ROOM_ID": room_id,
            "CREATE_ID": lib.user_id,
            "REMARK": "",
            "RES_YYYYMMDD": d,
            "RES_HOUR": lh,
            "ADMIN_YN": lib.admin_yn,
        })
        if not rs:
            return {"booked": booked, "failed": h, "message": f"{lh:02d}:00 is already reserved"}
        booked.append(h)
    return {"booked": booked}


def cancel(lib, items):
    # Latest hour first, so no cancellation ever leaves a 1-hour gap inside a run of bookings.
    cancelled, failed = [], []
    for it in sorted(items, key=lambda x: (x["room"], x["date"], x["hour"]), reverse=True):
        rs = lib.call("/work/cancelFacilityreservation", {
            "ROOM_ID": it["room"],
            "RES_YYYYMMDD": it["date"],
            "RES_HOUR": it["hour"],
            "RES_ID": it["resId"],
        })
        (cancelled if rs else failed).append(it)
    return {"cancelled": cancelled, "failed": failed}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "static"), **kwargs)

    def end_headers(self):
        # Always revalidate, so edits to static files show up without a hard refresh.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def session(self):
        return SESSIONS.get(self.headers.get("X-Session") or "")

    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        lib = self.session()
        if url.path == "/api/me":
            return self.send_json({"user": user_info(lib) if lib else None})
        if url.path != "/api/day":
            return self.send_error(404)
        if not lib:
            return self.send_json({"error": "login"}, 401)
        try:
            res_date = parse_qs(url.query)["date"][0]
            self.send_json(get_day(lib, res_date))
        except Exception as e:
            self.send_json({"error": str(e)}, 502)

    def do_POST(self):
        if self.path not in ("/api/login", "/api/logout", "/api/reserve", "/api/cancel"):
            return self.send_error(404)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/login":
                token, user = login(body["id"], body["password"])
                return self.send_json({"token": token, "user": user})
            if self.path == "/api/logout":
                SESSIONS.pop(self.headers.get("X-Session") or "", None)
                return self.send_json({"user": None})
            lib = self.session()
            if not lib:
                return self.send_json({"error": "login"}, 401)
            if self.path == "/api/cancel":
                self.send_json(cancel(lib, body["items"]))
            else:
                self.send_json(reserve(lib, int(body["roomId"]), body["date"], [int(h) for h in body["hours"]]))
        except LoginError as e:
            self.send_json({"error": str(e)}, 401)
        except Exception as e:
            self.send_json({"error": str(e)}, 502)


if __name__ == "__main__":
    port = int(ENV.get("PORT", 8000))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving on http://localhost:{port}")
    server.serve_forever()
