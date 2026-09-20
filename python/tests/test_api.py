"""The server's workspace interface: its guards, and compare-and-swap over HTTP."""

import http.client
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from test_runner import FakeSocket, runner_for

from sponsifer import api, workspace
from sponsifer.serve import make_server

PORT = 5180
ORIGIN = f"http://127.0.0.1:{PORT}"


def ws(**extra):
    return {"version": 5, "profile": {"name": "Ada"}, "terms": {}, "prospects": [], "deals": [], "board": {}, **extra}


@pytest.fixture
def ctx(tmp_path: Path) -> api.Context:
    return api.Context(tmp_path / "workspace.json", PORT)


def get(ctx, path="/api/workspace", **headers):
    return api.handle("GET", path, {"Host": f"127.0.0.1:{PORT}", **headers}, b"", ctx)


def put(ctx, data, **headers):
    base = {"Host": f"127.0.0.1:{PORT}", "Origin": ORIGIN, "Content-Type": "application/json"}
    body = data if isinstance(data, bytes) else json.dumps(data).encode()
    return api.handle("PUT", "/api/workspace", {**base, **headers}, body, ctx)


def etag(response):
    return response.headers["ETag"]


# Guards


@pytest.mark.parametrize("host", ["evil.example", "evil.example:5180", "127.0.0.1:9999", None])
def test_a_request_naming_another_host_is_refused(ctx, host):
    headers = {} if host is None else {"Host": host}
    assert api.handle("GET", "/api/workspace", headers, b"", ctx).status == 403


def test_localhost_is_this_server_too(ctx):
    assert api.handle("GET", "/api/info", {"Host": f"localhost:{PORT}"}, b"", ctx).status == 200


@pytest.mark.parametrize("origin", [None, "https://evil.example", "null", "http://localhost:5181"])
def test_a_write_from_another_origin_is_refused(ctx, origin):
    headers = {"Origin": origin} if origin else {"Origin": ""}
    assert put(ctx, ws(), **headers, **{"If-None-Match": "*"}).status == 403
    assert not ctx.workspace.exists()


def test_an_allowed_development_origin_may_write(tmp_path: Path):
    ctx = api.Context(tmp_path / "workspace.json", PORT, frozenset({"http://localhost:5173"}))
    assert put(ctx, ws(), Origin="http://localhost:5173", **{"If-None-Match": "*"}).status == 200


def test_a_write_that_is_not_json_is_refused(ctx):
    assert put(ctx, ws(), **{"Content-Type": "text/plain", "If-None-Match": "*"}).status == 415


def test_an_oversized_write_is_refused(ctx):
    assert put(ctx, b"x" * (api.MAX_BODY + 1), **{"If-None-Match": "*"}).status == 413


def test_no_response_carries_cors_headers(ctx):
    for response in (get(ctx), put(ctx, ws(), **{"If-None-Match": "*"}), get(ctx), get(ctx, "/api/info")):
        assert not any(k.lower().startswith("access-control") for k in response.headers)


# Reading


def test_a_missing_workspace_says_so(ctx):
    response = get(ctx)
    assert response.status == 404
    assert json.loads(response.body) == {"missing": True}


def test_reading_returns_the_bytes_on_disk_with_their_revision(ctx):
    rev = workspace.save(ctx.workspace, ws())
    response = get(ctx)
    assert response.status == 200
    assert response.body == ctx.workspace.read_bytes()
    assert etag(response) == f'"{rev}"'


def test_an_unchanged_workspace_is_not_sent_again(ctx):
    rev = workspace.save(ctx.workspace, ws())
    assert get(ctx, **{"If-None-Match": f'"{rev}"'}).status == 304


def test_a_file_that_is_not_json_is_reported_with_its_revision(ctx):
    ctx.workspace.write_text("{ not json", encoding="utf-8")
    response = get(ctx)
    assert response.status == 422
    assert etag(response) == f'"{workspace.current_revision(ctx.workspace)}"'


def test_info_names_the_file(ctx):
    info = json.loads(get(ctx, "/api/info").body)
    assert info["workspacePath"] == str(ctx.workspace)
    assert info["format"] == workspace.SUPPORTED_VERSION


# Writing


def test_create_only_when_there_is_no_file(ctx):
    assert put(ctx, ws(), **{"If-None-Match": "*"}).status == 200
    assert put(ctx, ws(), **{"If-None-Match": "*"}).status == 409


def test_a_write_without_a_precondition_is_refused(ctx):
    assert put(ctx, ws()).status == 428


def test_a_write_at_the_current_revision_replaces_the_file(ctx):
    rev = workspace.save(ctx.workspace, ws())
    response = put(ctx, ws(profile={"name": "Ada Trelawny"}), **{"If-Match": f'"{rev}"'})
    assert response.status == 200
    assert json.loads(ctx.workspace.read_text(encoding="utf-8"))["profile"]["name"] == "Ada Trelawny"
    assert etag(response) == f'"{workspace.current_revision(ctx.workspace)}"'


def test_a_write_from_a_stale_read_is_refused_and_the_file_kept(ctx):
    stale = workspace.save(ctx.workspace, ws())
    workspace.save(ctx.workspace, ws(deals=[{"id": "dl-1", "seal": {"serial": "abc"}}]))  # the CLI sealed
    response = put(ctx, ws(), **{"If-Match": f'"{stale}"'})
    assert response.status == 409
    assert etag(response) == f'"{workspace.current_revision(ctx.workspace)}"'
    assert json.loads(ctx.workspace.read_text(encoding="utf-8"))["deals"][0]["seal"] == {"serial": "abc"}


@pytest.mark.parametrize(
    "body",
    [ws(version=6), ws(version=4), {**ws(), "deals": None}, [ws()], "workspace"],
    ids=["newer", "older", "no-deals", "a-list", "a-string"],
)
def test_a_body_that_is_not_a_current_workspace_is_never_written(ctx, body):
    assert put(ctx, body, **{"If-None-Match": "*"}).status == 422
    assert not ctx.workspace.exists()


def test_replacing_an_unreadable_file_copies_it_aside(ctx):
    ctx.workspace.write_text("{ not json", encoding="utf-8")
    rev = workspace.current_revision(ctx.workspace)
    response = put(ctx, ws(), **{"If-Match": f'"{rev}"', "X-Replace-Unreadable": "1"})
    assert response.status == 200
    aside = ctx.workspace.with_name(f"workspace.unreadable-{rev[:12]}.json")
    assert aside.read_text(encoding="utf-8") == "{ not json"


def test_other_methods_are_not_allowed(ctx):
    base = {"Host": f"127.0.0.1:{PORT}", "Origin": ORIGIN}
    assert api.handle("DELETE", "/api/workspace", base, b"", ctx).status == 405
    assert api.handle("GET", "/api/nothing", base, b"", ctx).status == 404


# The on-air log, read-only


def test_the_on_air_view_says_when_there_is_no_log(ctx):
    response = get(ctx, "/api/onair/dl-104")
    assert response.status == 404 and json.loads(response.body) == {"missing": True}


def test_the_on_air_view_folds_the_log_and_lists_the_reports(tmp_path: Path):
    from sponsifer import onair, report
    ctx = api.Context(tmp_path / "workspace.json", PORT, home=tmp_path)
    log = onair.log_path(tmp_path, "dl-104")
    onair.append(log, {"kind": "stream", "at": "2026-09-18T20:00:00.000+00:00", "live": True, "startObserved": True})
    onair.append(log, {"kind": "onair", "at": "2026-09-18T20:05:00.000+00:00", "state": "start"})
    onair.append(log, {"kind": "onair", "at": "2026-09-18T20:06:30.000+00:00", "state": "end"})
    folder = report.reports_dir(tmp_path)
    folder.mkdir()
    (folder / "dl-104-20260918T220000Z.report.json").write_text("{}", encoding="utf-8")
    (folder / "dl-999-20260918T220000Z.report.json").write_text("{}", encoding="utf-8")
    body = json.loads(get(ctx, "/api/onair/dl-104").body)
    assert body["totalSeconds"] == 90
    assert body["intervals"][0]["streamOffsetSeconds"] == 300
    assert body["reports"] == ["dl-104-20260918T220000Z"]


@pytest.mark.parametrize("bad", ["../workspace", "dl-1/../x", "dl%2F1", "a" * 65, ""])
def test_the_on_air_view_refuses_anything_that_is_not_a_deal_id(ctx, bad):
    response = get(ctx, f"/api/onair/{bad}")
    assert response.status in (400, 404)
    assert not ctx.workspace.exists()


# The on-air logger, started and stopped from the app


def logger_ctx(tmp_path: Path, socket, deals=None) -> api.Context:
    path = tmp_path / "workspace.json"
    won = [{"id": "dl-104", "outcome": "won"}, {"id": "dl-200", "outcome": "won"}, {"id": "dl-300", "outcome": "lost"}]
    workspace.save(path, ws(deals=won if deals is None else deals), expected=workspace.ABSENT)
    return api.Context(path, PORT, runner=runner_for(tmp_path, socket))


def post(ctx, action, data=None, **headers):
    base = {"Host": f"127.0.0.1:{PORT}", "Origin": ORIGIN, "Content-Type": "application/json"}
    return api.handle("POST", f"/api/logger/{action}", {**base, **headers}, json.dumps(data or {}).encode(), ctx)


def body(response):
    return json.loads(response.body)


def test_the_logger_starts_for_a_won_deal_reports_itself_and_stops(tmp_path: Path):
    ctx = logger_ctx(tmp_path, FakeSocket())
    assert body(get(ctx, "/api/logger"))["running"] is False
    started = post(ctx, "start", {"deal": "dl-104"})
    assert started.status == 200 and body(started)["running"] is True
    assert body(get(ctx, "/api/logger"))["deal"] == "dl-104"
    assert body(post(ctx, "stop"))["running"] is False


@pytest.mark.parametrize("action", ["start", "stop"])
@pytest.mark.parametrize("origin", ["https://evil.example", "null", ""])
def test_a_foreign_page_can_neither_start_nor_stop_the_logger(tmp_path: Path, action, origin):
    ctx = logger_ctx(tmp_path, FakeSocket())
    post(ctx, "start", {"deal": "dl-104"})
    assert post(ctx, action, {"deal": "dl-200"}, Origin=origin).status == 403
    status = body(get(ctx, "/api/logger"))
    assert status["running"] is True and status["deal"] == "dl-104", "the creator's evidence was not switched off"
    post(ctx, "stop")


def test_a_form_post_cannot_stop_the_logger(tmp_path: Path):
    ctx = logger_ctx(tmp_path, FakeSocket())
    post(ctx, "start", {"deal": "dl-104"})
    assert post(ctx, "stop", **{"Content-Type": "text/plain"}).status == 415
    assert body(get(ctx, "/api/logger"))["running"] is True
    post(ctx, "stop")


def test_the_logger_answers_only_to_this_host(tmp_path: Path):
    ctx = logger_ctx(tmp_path, FakeSocket())
    assert post(ctx, "start", {"deal": "dl-104"}, Host="rebound.example").status == 403
    assert api.handle("GET", "/api/logger", {"Host": "rebound.example"}, b"", ctx).status == 403


@pytest.mark.parametrize("deal, status", [("dl-999", 404), ("dl-300", 409), ("../../etc/passwd", 400), (None, 400), (7, 400)])
def test_only_a_won_deal_in_the_workspace_can_be_logged(tmp_path: Path, deal, status):
    ctx = logger_ctx(tmp_path, FakeSocket())
    assert post(ctx, "start", {"deal": deal}).status == status
    assert body(get(ctx, "/api/logger"))["running"] is False
    assert not (tmp_path / "onair").exists()


def test_a_deal_recorded_seconds_ago_may_not_be_in_the_file_yet_and_the_refusal_says_so(tmp_path: Path):
    # Found in a real browser: the app saves a moment after an edit, and Start was pressed inside that moment.
    refused = post(logger_ctx(tmp_path, FakeSocket(), deals=[]), "start", {"deal": "dl-104"})
    assert refused.status == 404
    assert "still being saved" in body(refused)["error"] and "try again" in body(refused)["error"]


def test_a_second_deal_is_refused_while_one_is_logging_and_the_same_deal_is_not_an_error(tmp_path: Path):
    ctx = logger_ctx(tmp_path, FakeSocket())
    post(ctx, "start", {"deal": "dl-104"})
    other = post(ctx, "start", {"deal": "dl-200"})
    assert other.status == 409 and body(other)["deal"] == "dl-104"
    assert post(ctx, "start", {"deal": "dl-104"}).status == 200
    post(ctx, "stop")


def test_obs_asking_for_a_password_is_passed_on_and_the_password_is_never_echoed(tmp_path: Path):
    ctx = logger_ctx(tmp_path, FakeSocket(password="hunter2"))
    asked = post(ctx, "start", {"deal": "dl-104"})
    assert asked.status == 502 and body(asked)["needsPassword"] is True

    ctx = logger_ctx(tmp_path / "again", FakeSocket(password="hunter2"))
    started = post(ctx, "start", {"deal": "dl-104", "password": "hunter2"})
    assert started.status == 200 and b"hunter2" not in started.body
    assert b"hunter2" not in get(ctx, "/api/logger").body
    post(ctx, "stop")


def test_a_server_built_without_a_logger_says_there_is_no_such_endpoint(ctx):
    assert get(ctx, "/api/logger").status == 404
    assert post(ctx, "start", {"deal": "dl-104"}).status == 404


# Over a real socket


def test_the_server_answers_over_http(tmp_path: Path):
    server = make_server(tmp_path / "workspace.json", port=0, api_only=True)
    port = server.ctx.port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{port}"
        body = json.dumps(ws()).encode()
        request = urllib.request.Request(f"{base}/api/workspace", data=body, method="PUT", headers={
            "Origin": base, "Content-Type": "application/json", "If-None-Match": "*"})
        with urllib.request.urlopen(request) as response:
            assert response.status == 200
        with urllib.request.urlopen(f"{base}/api/workspace") as response:
            assert json.loads(response.read())["profile"]["name"] == "Ada"
        with pytest.raises(urllib.error.HTTPError) as refused:
            urllib.request.urlopen(f"{base}/")  # --api-only serves no app
        assert refused.value.code == 404
    finally:
        server.shutdown()
        server.server_close()


def test_the_dock_is_served_fresh_and_only_to_this_host(tmp_path: Path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "dock.html").write_text("<p>dock</p>", encoding="utf-8")
    server = make_server(tmp_path / "workspace.json", port=0, web=web)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        port = server.ctx.port
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/dock.html") as response:
            assert response.read() == b"<p>dock</p>"
            # OBS keeps a dock's page as it keeps a browser source's, so it must revalidate after a rebuild.
            assert response.headers.get("Cache-Control") == "no-cache"
        connection = http.client.HTTPConnection("127.0.0.1", port)
        connection.request("GET", "/dock.html", headers={"Host": "rebound.example"})
        assert connection.getresponse().status == 403
        connection.close()
    finally:
        server.shutdown()
        server.server_close()


def test_the_overlay_is_served_and_a_foreign_host_is_refused_everywhere(tmp_path: Path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "overlay.html").write_text("<p>overlay</p>", encoding="utf-8")
    server = make_server(tmp_path / "workspace.json", port=0, web=web)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.ctx.port
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/overlay?deal=dl-1") as response:
            assert response.read() == b"<p>overlay</p>"
            # OBS's embedded browser must revalidate the page, or a rebuild leaves it on stale assets.
            assert response.headers.get("Cache-Control") == "no-cache"
        connection = http.client.HTTPConnection("127.0.0.1", port)
        connection.request("GET", "/overlay", headers={"Host": "rebound.example"})
        assert connection.getresponse().status == 403
        connection.close()
    finally:
        server.shutdown()
        server.server_close()
