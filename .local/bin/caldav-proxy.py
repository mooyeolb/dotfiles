#!/usr/bin/env python3
# CalDAV privilege proxy — injects missing <D:read/> privilege

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import ssl

TARGET = "https://caldav.calendar.navercorp.com"
PORT = 23153

class ProxyHandler(BaseHTTPRequestHandler):
    def do_request(self):
        url = TARGET + self.path
        skip = {"host", "content-length", "accept-encoding"}
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in skip}

        body = None
        if "content-length" in self.headers:
            body = self.rfile.read(int(self.headers["content-length"]))

        req = urllib.request.Request(url, data=body, headers=headers,
                                     method=self.command)
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, context=ctx) as resp:
                data = resp.read()
                if b"current-user-privilege-set" in data:
                    data = data.replace(
                        b"<D:current-user-privilege-set>",
                        b"<D:current-user-privilege-set><D:privilege><D:read/></D:privilege>"
                    )
                self.send_response(resp.status)
                skip_resp = {"transfer-encoding", "content-encoding", "content-length", "dav"}
                for k, v in resp.headers.items():
                    if k.lower() not in skip_resp:
                        self.send_header(k, v)
                self.send_header("DAV", "1, 2, calendar-access")
                self.send_header("Content-Length", len(data))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            skip_resp = {"transfer-encoding", "content-encoding", "content-length"}
            for k, v in e.headers.items():
                if k.lower() not in skip_resp:
                    self.send_header(k, v)
            self.send_header("Content-Length", len(data))
            self.end_headers()
            self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_DELETE = do_PROPFIND = do_REPORT = do_OPTIONS = do_request

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), ProxyHandler)
    print(f"CalDAV proxy listening on http://127.0.0.1:{PORT}")
    server.serve_forever()
