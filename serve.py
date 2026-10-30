#!/usr/bin/env python3
"""Local browser interface backed by the existing Python IXN engine.

Run: python serve.py --port 8765
The hosted site runs in-browser; this optional server adds native execution and
server-folder paths. It uses only the standard library plus model dependencies.
"""
import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse
import uuid

PROJECT = Path(__file__).resolve().parent
DIST = PROJECT/'dist'
JOBS = {}
RUNTIME = Path(tempfile.mkdtemp(prefix='ixn-interface-'))


def job_main(folder):
    sys.path.insert(0, str(DIST/'python'))
    from interface_engine import analyze
    folder = Path(folder)
    def progress(message):
        with (folder/'progress.jsonl').open('a') as f:
            f.write(json.dumps(str(message))+'\n')
    try:
        request = json.loads((folder/'request.json').read_text())
        result, archive = analyze(request, folder, progress)
        (folder/'result.json').write_text(json.dumps(result, allow_nan=False))
    except Exception as error:
        (folder/'error.json').write_text(json.dumps(dict(error=str(error))))
        raise


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def json_response(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == '/api/capabilities':
            return self.json_response(dict(local=True))
        if path.startswith('/api/jobs/'):
            parts = path.split('/')
            job = JOBS.get(parts[3]) if len(parts)>3 else None
            if not job:
                return self.json_response(dict(error='Analysis not found.'), 404)
            folder, process = job['folder'], job['process']
            if len(parts)>=6 and parts[4]=='files':
                filename = '/'.join(parts[5:])
                if filename not in ['ixn_results.zip', 'results/results.xlsx', 'results/plot_year_results.pdf']:
                    return self.json_response(dict(error='File not found.'), 404)
                source = folder/filename
                if not source.is_file():
                    return self.json_response(dict(error='Output is not available yet.'), 404)
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(source.name)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(source.stat().st_size))
                self.send_header('Content-Disposition', 'attachment; filename="'+source.name+'"')
                self.end_headers()
                with source.open('rb') as f:
                    while True:
                        block=f.read(1024*1024)
                        if not block: break
                        self.wfile.write(block)
                return
            progress = []
            if (folder/'progress.jsonl').exists():
                for line in (folder/'progress.jsonl').read_text().splitlines():
                    try: progress.append(json.loads(line))
                    except ValueError: pass
            if (folder/'result.json').exists():
                return self.json_response(dict(status='done', progress=progress, result=json.loads((folder/'result.json').read_text())))
            if (folder/'error.json').exists():
                return self.json_response(dict(status='error', progress=progress, **json.loads((folder/'error.json').read_text())))
            if process.poll() is not None:
                return self.json_response(dict(status='error', progress=progress, error='Calculation stopped. Check the server log or rerun with a smaller dataset.'))
            return self.json_response(dict(status='running', progress=progress))
        return super().do_GET()

    def do_POST(self):
        origin=self.headers.get('Origin')
        if origin and urlparse(origin).netloc != self.headers.get('Host'):
            return self.json_response(dict(error='Use this application from its own browser page.'), 403)
        path=unquote(urlparse(self.path).path)
        if path.startswith('/api/jobs/') and path.endswith('/cancel'):
            job=JOBS.get(path.split('/')[3])
            if job and job['process'].poll() is None:
                job['process'].terminate()
            return self.json_response(dict(cancelled=True))
        if path != '/api/jobs':
            return self.json_response(dict(error='Endpoint not found.'), 404)
        if self.headers.get_content_type() != 'application/json':
            return self.json_response(dict(error='Expected a JSON request.'), 415)
        try:
            size=int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 350*1024*1024:
                raise ValueError('Upload size must be below 250 MB before encoding.')
            body=json.loads(self.rfile.read(size))
            if sum(j['process'].poll() is None for j in JOBS.values())>=2:
                return self.json_response(dict(error='Two analyses are already running. Wait or cancel one.'), 429)
            identity=uuid.uuid4().hex
            folder=RUNTIME/identity
            folder.mkdir()
            config=body['config']
            config['files']={}
            for upload in body.get('uploads', []):
                role=upload['role']
                if role not in ['raw', 'workbook', 'weather', 'irrigation', 'nitrate', 'moisture', 'plots', 'collection_calendar', 'run_config']:
                    raise ValueError('Unknown upload type.')
                name=Path(upload['name'].replace('\\','/'))
                if name.is_absolute() or '..' in name.parts:
                    raise ValueError('Invalid input path.')
                destination=folder/'raw'/name if role=='raw' else folder/'inputs'/role/name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(base64.b64decode(upload['data'], validate=True))
                if role!='raw': config['files'][role]=str(destination)
            if config.get('mode')=='raw' and (folder/'raw').exists():
                config['raw_root']=str(folder/'raw')
            (folder/'request.json').write_text(json.dumps(config))
            log=(folder/'engine.log').open('w')
            process=subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--job', str(folder)], stdout=log, stderr=subprocess.STDOUT)
            log.close()
            JOBS[identity]=dict(folder=folder, process=process)
            self.json_response(dict(id=identity), 202)
        except (ValueError, KeyError, TypeError) as error:
            self.json_response(dict(error=str(error)), 400)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--job', help=argparse.SUPPRESS)
    args=parser.parse_args()
    if args.job:
        job_main(args.job)
    else:
        server=ThreadingHTTPServer((args.host,args.port), Handler)
        print(f'IXN interface: http://{args.host}:{args.port}', flush=True)
        print('Outputs for this session: '+str(RUNTIME), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            for job in JOBS.values():
                if job['process'].poll() is None: job['process'].terminate()
