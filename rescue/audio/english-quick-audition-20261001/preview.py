import http.server
import json
from pathlib import Path
from functools import partial
HERE=Path(__file__).resolve().parent
handler=partial(http.server.SimpleHTTPRequestHandler,directory=str(HERE))
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
(HERE/'preview.json').write_text(json.dumps({'url':f'http://127.0.0.1:{server.server_port}/'}))
server.serve_forever()
