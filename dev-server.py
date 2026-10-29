import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import sys
import os
import time
import hashlib

# Load configuration from .env file if present
def load_env():
    if os.path.exists('.env'):
        try:
            with open('.env', 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        os.environ.setdefault(k.strip(), v.strip())
        except Exception as e:
            print('[VoltEdge DevServer] Warning loading .env:', e)

load_env()

PORT = int(os.getenv('PORT', 8000))
ORDER_WEBHOOK = os.getenv('VOLTEDGE_ORDER_WEBHOOK_URL', 'https://ucy00zep.rpcld.net/webhook/voltedge-order')
ORDER_DETAILS_WEBHOOK = os.getenv('VOLTEDGE_ORDER_DETAILS_WEBHOOK_URL', 'https://ucy00zep.rpcld.net/webhook/voltedge-order-details')
FEEDBACK_WEBHOOK = os.getenv('VOLTEDGE_FEEDBACK_WEBHOOK_URL', '')

RATE_LIMITS = {
    'order_submission': {
        'limit': int(os.getenv('RATE_LIMIT_ORDER_MAX', 5)),
        'window_sec': int(os.getenv('RATE_LIMIT_ORDER_WINDOW_SEC', 60))
    },
    'order_lookup': {
        'limit': int(os.getenv('RATE_LIMIT_LOOKUP_MAX', 20)),
        'window_sec': int(os.getenv('RATE_LIMIT_LOOKUP_WINDOW_SEC', 60))
    },
    'feedback': {
        'limit': int(os.getenv('RATE_LIMIT_FEEDBACK_MAX', 5)),
        'window_sec': int(os.getenv('RATE_LIMIT_FEEDBACK_WINDOW_SEC', 60))
    }
}

# In-Memory Sliding Window Store: Map<key, list of timestamps>
rate_limit_store = {}
idempotency_store = {}

def get_client_ip(handler):
    headers = handler.headers
    x_real_ip = headers.get('x-real-ip')
    if x_real_ip:
        return x_real_ip.split(',')[0].strip()
    x_forwarded_for = headers.get('x-forwarded-for')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return handler.client_address[0] if handler.client_address else '127.0.0.1'

def check_rate_limit(category, client_ip):
    config = RATE_LIMITS.get(category, {'limit': 10, 'window_sec': 60})
    limit = config['limit']
    window_sec = config['window_sec']
    window_ms = window_sec * 1000

    hashed_ip = hashlib.sha256(f"dev:{category}:{client_ip}".encode()).hexdigest()[:24]
    key = f"rl:{category}:{hashed_ip}"

    now = int(time.time() * 1000)
    threshold = now - window_ms

    timestamps = rate_limit_store.get(key, [])
    valid_timestamps = [t for t in timestamps if t > threshold]

    oldest = valid_timestamps[0] if valid_timestamps else now
    reset_sec = max(1, int(((oldest + window_ms) - now) / 1000))

    if len(valid_timestamps) >= limit:
        rate_limit_store[key] = valid_timestamps
        return {
            'allowed': False,
            'limit': limit,
            'remaining': 0,
            'reset_sec': reset_sec,
            'retry_after': reset_sec
        }

    valid_timestamps.append(now)
    rate_limit_store[key] = valid_timestamps
    return {
        'allowed': True,
        'limit': limit,
        'remaining': max(0, limit - len(valid_timestamps)),
        'reset_sec': reset_sec
    }

class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        client_ip = get_client_ip(self)

        # 1. Feedback Form Endpoint
        if self.path.startswith('/api/feedback'):
            rl = check_rate_limit('feedback', client_ip)

            if not rl['allowed']:
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('X-RateLimit-Limit', str(rl['limit']))
                self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                self.send_header('X-RateLimit-Store', 'dev-memory')
                self.send_header('Retry-After', str(rl['retry_after']))
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'Too Many Requests',
                    'message': "You're making requests too quickly. Please wait a moment and try again.",
                    'retryAfter': rl['retry_after']
                }).encode())
                return

            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('X-RateLimit-Limit', str(rl['limit']))
            self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
            self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
            self.send_header('X-RateLimit-Store', 'dev-memory')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'message': 'Thank you for your feedback! Our team has received your message.'
            }).encode())
            return

        # 2. Order Submission Endpoint
        if self.path.startswith('/api/voltedge-order'):
            rl = check_rate_limit('order_submission', client_ip)

            if not rl['allowed']:
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('X-RateLimit-Limit', str(rl['limit']))
                self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                self.send_header('X-RateLimit-Store', 'dev-memory')
                self.send_header('Retry-After', str(rl['retry_after']))
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'Too Many Requests',
                    'message': "You're making requests too quickly. Please wait a moment and try again.",
                    'retryAfter': rl['retry_after']
                }).encode())
                return

            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length)

            # Idempotency duplicate check
            order_id = None
            try:
                body_data = json.loads(post_body.decode('utf-8'))
                order_id = body_data.get('orderId') or body_data.get('order_id')
                if order_id and order_id in idempotency_store:
                    entry = idempotency_store[order_id]
                    if time.time() - entry['timestamp'] < 300: # 5 mins
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('X-RateLimit-Limit', str(rl['limit']))
                        self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                        self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                        self.send_header('X-RateLimit-Store', 'dev-memory')
                        self.end_headers()
                        self.wfile.write(entry['response'])
                        return
            except Exception:
                pass

            candidate_urls = [
                ORDER_WEBHOOK,
                'https://ucy00zep.rpcld.net/webhook-test/voltedge-order'
            ]
            last_err_content = None
            last_status = 502
            for target_url in candidate_urls:
                try:
                    req = urllib.request.Request(target_url, data=post_body, headers={
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Origin': 'https://voltedge-tech-accessories.vercel.app'
                    }, method='POST')
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        content = resp.read()
                        if order_id and resp.status == 200:
                            idempotency_store[order_id] = {
                                'timestamp': time.time(),
                                'response': content
                            }
                        self.send_response(resp.status)
                        self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                        self.send_header('X-RateLimit-Limit', str(rl['limit']))
                        self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                        self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                        self.send_header('X-RateLimit-Store', 'dev-memory')
                        self.end_headers()
                        self.wfile.write(content)
                        return
                except urllib.error.HTTPError as e:
                    last_status = e.code
                    last_err_content = e.read()
                    if e.code == 404:
                        continue
                    self.send_response(e.code)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('X-RateLimit-Limit', str(rl['limit']))
                    self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                    self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                    self.send_header('X-RateLimit-Store', 'dev-memory')
                    self.end_headers()
                    self.wfile.write(last_err_content)
                    return
                except Exception as e:
                    last_err_content = json.dumps({'success': False, 'message': str(e)}).encode()
                    continue

            self.send_response(last_status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(last_err_content if last_err_content else b'{"error":"not found"}')
            return

        self.send_response(404)
        self.end_headers()

    def do_GET(self):
        client_ip = get_client_ip(self)

        # Proxy endpoint for order details
        if self.path.startswith('/api/voltedge-order-details'):
            rl = check_rate_limit('order_lookup', client_ip)

            if not rl['allowed']:
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('X-RateLimit-Limit', str(rl['limit']))
                self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                self.send_header('X-RateLimit-Store', 'dev-memory')
                self.send_header('Retry-After', str(rl['retry_after']))
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'Too Many Requests',
                    'message': "You're making requests too quickly. Please wait a moment and try again.",
                    'retryAfter': rl['retry_after']
                }).encode())
                return

            parsed = urllib.parse.urlparse(self.path)
            candidate_urls = [
                f'{ORDER_DETAILS_WEBHOOK}?{parsed.query}',
                f'https://ucy00zep.rpcld.net/webhook-test/voltedge-order-details?{parsed.query}'
            ]
            last_err_content = None
            last_status = 502
            for target_url in candidate_urls:
                try:
                    req = urllib.request.Request(target_url, headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Origin': 'https://voltedge-tech-accessories.vercel.app'
                    })
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        content = resp.read()
                        self.send_response(resp.status)
                        self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                        self.send_header('X-RateLimit-Limit', str(rl['limit']))
                        self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                        self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                        self.send_header('X-RateLimit-Store', 'dev-memory')
                        self.end_headers()
                        self.wfile.write(content)
                        return
                except urllib.error.HTTPError as e:
                    last_status = e.code
                    last_err_content = e.read()
                    if e.code == 404:
                        continue
                    self.send_response(e.code)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('X-RateLimit-Limit', str(rl['limit']))
                    self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                    self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                    self.send_header('X-RateLimit-Store', 'dev-memory')
                    self.end_headers()
                    self.wfile.write(last_err_content)
                    return
                except Exception as e:
                    last_err_content = json.dumps({'success': False, 'message': str(e)}).encode()
                    continue

            self.send_response(last_status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(last_err_content if last_err_content else b'{"error":"not found"}')
            return

        super().do_GET()

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), DevHandler) as httpd:
        print(f'VoltEdge Dev Server running on http://localhost:{PORT}')
        httpd.serve_forever()
