"""The server's workspace interface: its guards, and compare-and-swap over HTTP."""

import http.client
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

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
