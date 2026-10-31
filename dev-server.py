import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import sys
import os
import time
import datetime
import hashlib
import re

# Sanitization Utilities
def sanitize_str(val, max_len=255):
    if not isinstance(val, str):
        return ''
    clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', val)
    clean = re.sub(r'<[^>]*>', '', clean)
    clean = re.sub(r'(?i)javascript:', '', clean)
    clean = re.sub(r'(?i)\bon\w+\s*=', '', clean)
    return clean.strip()[:max_len]

def sanitize_email(val):
    if not isinstance(val, str):
        return ''
    clean = re.sub(r'<[^>]*>', '', val)
    clean = re.sub(r"""[\s"'\\]""", "", clean)
    return clean.strip()[:120]

def sanitize_phone(val):
    if not isinstance(val, str):
        return ''
    clean = re.sub(r'[^0-9+\s-]', '', val)
    clean = re.sub(r'\s+', ' ', clean)
    return clean.strip()[:25]

FRIENDLY_ERROR_JSON = {
    'success': False,
    'error': 'OrderProcessingError',
    'message': 'An error occurred, please try again later or contact us on WhatsApp.'
}

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

# Authoritative In-Memory Order Store for local cross-device simulation
order_store = {}

def normalize_order(data):
    if not isinstance(data, dict):
        return None
    order_id = str(data.get('order_id') or data.get('orderId') or data.get('trackingCode') or '').strip()
    if not order_id:
        return None
    token = str(data.get('token') or data.get('lookup_token') or data.get('lookupToken') or '').strip()
    cust = data.get('customer') if isinstance(data.get('customer'), dict) else {}
    customer_name = sanitize_str(data.get('customer_name') or data.get('customerName') or data.get('fullName') or cust.get('fullName') or cust.get('name') or '', 100)
    customer_email = sanitize_email(data.get('customer_email') or data.get('customerEmail') or data.get('email') or cust.get('email') or '')
    customer_phone = sanitize_phone(data.get('customer_phone') or data.get('customerPhone') or data.get('phone') or data.get('fullPhone') or cust.get('fullPhone') or cust.get('phone') or '')
    delivery_address = sanitize_str(data.get('delivery_address') or data.get('deliveryAddress') or data.get('address') or cust.get('address') or '', 255)
    delivery_state = sanitize_str(data.get('delivery_state') or data.get('deliveryState') or data.get('state') or cust.get('state') or cust.get('deliveryState') or '', 60)
    delivery_notes = sanitize_str(data.get('delivery_notes') or data.get('deliveryNotes') or data.get('orderNotes') or data.get('notes') or cust.get('notes') or 'None provided', 500)

    prod = data.get('product') if isinstance(data.get('product'), dict) else ((data.get('items') or [{}])[0] if isinstance(data.get('items'), list) else {})
    product_name = str(data.get('product_name') or data.get('productName') or prod.get('name') or prod.get('shortName') or 'VoltEdge Hardware').strip()
    product_sku = str(data.get('product_sku') or data.get('productSku') or data.get('sku') or prod.get('sku') or prod.get('id') or 'VE-EQUIPMENT').strip()
    quantity = int(data.get('quantity') or data.get('qty') or prod.get('quantity') or 1)
    unit_price = int(data.get('unit_price') or data.get('unitPrice') or prod.get('unitPrice') or prod.get('price') or 0)
    total_price = int(data.get('total_price') or data.get('totalPrice') or data.get('totalAmount') or prod.get('totalAmount') or prod.get('totalPrice') or (unit_price * quantity))

    # Multi-product list
    products = []
    if isinstance(data.get('products'), list) and len(data['products']) > 0:
        for p in data['products']:
            if isinstance(p, dict):
                up = int(p.get('unit_price') or p.get('unitPrice') or p.get('price') or 0)
                q = int(p.get('quantity') or p.get('qty') or 1)
                lt = int(p.get('line_total') or p.get('lineTotal') or (up * q))
                products.append({
                    'product_sku': str(p.get('product_sku') or p.get('productSku') or p.get('sku') or 'VE-EQUIPMENT').strip(),
                    'product_name': str(p.get('product_name') or p.get('productName') or p.get('name') or 'VoltEdge Hardware').strip(),
                    'unit_price': up,
                    'quantity': q,
                    'line_total': lt
                })
    elif isinstance(data.get('products_json'), str) and data['products_json'].strip():
        try:
            parsed = json.loads(data['products_json'])
            if isinstance(parsed, list):
                for p in parsed:
                    if isinstance(p, dict):
                        up = int(p.get('unit_price') or p.get('unitPrice') or p.get('price') or 0)
                        q = int(p.get('quantity') or p.get('qty') or 1)
                        lt = int(p.get('line_total') or p.get('lineTotal') or (up * q))
                        products.append({
                            'product_sku': str(p.get('product_sku') or p.get('productSku') or p.get('sku') or 'VE-EQUIPMENT').strip(),
                            'product_name': str(p.get('product_name') or p.get('productName') or p.get('name') or 'VoltEdge Hardware').strip(),
                            'unit_price': up,
                            'quantity': q,
                            'line_total': lt
                        })
        except Exception:
            pass

    if len(products) > 0:
        if not total_price or total_price == 0:
            total_price = sum(p['line_total'] for p in products)
        derived_units = sum(p['quantity'] for p in products)
        if derived_units > 0:
            quantity = derived_units
        if len(products) > 1:
            product_sku = 'MULTIPLE'
            if not data.get('product_name'):
                product_name = '; '.join(f"{p['product_name']} x{p['quantity']}" for p in products)
            unit_price = total_price
        elif len(products) == 1:
            product_sku = products[0]['product_sku']
            product_name = products[0]['product_name']
            unit_price = products[0]['unit_price']
    else:
        products = [{
            'product_sku': product_sku,
            'product_name': product_name,
            'unit_price': unit_price or total_price,
            'quantity': quantity,
            'line_total': total_price or (unit_price * quantity)
        }]

    products_json = data.get('products_json') if (isinstance(data.get('products_json'), str) and data.get('products_json').strip()) else json.dumps(products)

    return {
        'order_id': order_id,
        'token': token,
        'lookup_token': token,
        'customer_name': customer_name,
        'customer_email': customer_email,
        'customer_phone': customer_phone,
        'delivery_address': delivery_address,
        'delivery_state': delivery_state,
        'delivery_notes': delivery_notes,
        'products': products,
        'products_json': products_json,
        'product_name': product_name,
        'product_sku': product_sku,
        'quantity': quantity,
        'unit_price': unit_price,
        'total_price': total_price,
        'currency': 'NGN',
        'order_status': str(data.get('order_status') or data.get('orderStatus') or data.get('status') or 'PENDING_PAYMENT').strip(),
        'payment_status': str(data.get('payment_status') or data.get('paymentStatus') or 'PENDING').strip(),
        'payment_link': str(data.get('payment_link') or data.get('paymentLink') or '').strip(),
        'image': str(data.get('image') or prod.get('image') or '').strip(),
        'created_at': data.get('createdAt') or data.get('timestamp') or datetime.datetime.now().isoformat(),
        'timestamp': data.get('timestamp') or data.get('createdAt') or datetime.datetime.now().isoformat(),
    }

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

            # Idempotency duplicate check & Authoritative Store
            order_id = None
            token = None
            try:
                body_data = json.loads(post_body.decode('utf-8'))
                # Server-side input sanitization
                if isinstance(body_data, dict):
                    if 'customer_name' in body_data: body_data['customer_name'] = sanitize_str(body_data['customer_name'], 100)
                    if 'customer_email' in body_data: body_data['customer_email'] = sanitize_email(body_data['customer_email'])
                    if 'customer_phone' in body_data: body_data['customer_phone'] = sanitize_phone(body_data['customer_phone'])
                    if 'delivery_address' in body_data: body_data['delivery_address'] = sanitize_str(body_data['delivery_address'], 255)
                    if 'delivery_state' in body_data: body_data['delivery_state'] = sanitize_str(body_data['delivery_state'], 60)
                    if 'delivery_notes' in body_data: body_data['delivery_notes'] = sanitize_str(body_data['delivery_notes'], 500)
                    if isinstance(body_data.get('customer'), dict):
                        c_dict = body_data['customer']
                        if 'name' in c_dict: c_dict['name'] = sanitize_str(c_dict['name'], 100)
                        if 'fullName' in c_dict: c_dict['fullName'] = sanitize_str(c_dict['fullName'], 100)
                        if 'email' in c_dict: c_dict['email'] = sanitize_email(c_dict['email'])
                        if 'phone' in c_dict: c_dict['phone'] = sanitize_phone(c_dict['phone'])
                        if 'fullPhone' in c_dict: c_dict['fullPhone'] = sanitize_phone(c_dict['fullPhone'])
                        if 'address' in c_dict: c_dict['address'] = sanitize_str(c_dict['address'], 255)
                        if 'state' in c_dict: c_dict['state'] = sanitize_str(c_dict['state'], 60)
                        if 'notes' in c_dict: c_dict['notes'] = sanitize_str(c_dict['notes'], 500)
                    post_body = json.dumps(body_data).encode('utf-8')

                order_id = body_data.get('orderId') or body_data.get('order_id') or body_data.get('trackingCode')
                if order_id:
                    token = body_data.get('token') or body_data.get('lookup_token') or body_data.get('lookupToken') or ('ve_tok_' + os.urandom(4).hex())
                    body_data['token'] = token
                    body_data['lookup_token'] = token
                    normalized = normalize_order(body_data)
                    if normalized:
                        order_store[order_id.lower()] = normalized

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
            except Exception as e:
                print('[VoltEdge DevServer] Error parsing order payload:', e)

            candidate_urls = [
                ORDER_WEBHOOK,
                'https://ucy00zep.rpcld.net/webhook/voltedge-order'
            ]
            last_err_content = json.dumps(FRIENDLY_ERROR_JSON).encode('utf-8')
            last_status = 502
            for target_url in candidate_urls:
                try:
                    parsed_host = urllib.parse.urlparse(target_url).netloc
                    req = urllib.request.Request(target_url, data=post_body, headers={
                        'Content-Type': 'application/json',
                        'Host': parsed_host,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Origin': 'https://voltedge-tech-accessories.vercel.app'
                    }, method='POST')
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        content = resp.read()

                        # Check for workflow error or technical error inside response body
                        is_workflow_err = False
                        try:
                            resp_json = json.loads(content.decode('utf-8'))
                            msg_str = str(resp_json.get('message') or resp_json.get('error') or '')
                            if 'workflow' in msg_str.lower() or 'error in' in msg_str.lower():
                                is_workflow_err = True
                        except Exception:
                            pass

                        if is_workflow_err or resp.status != 200:
                            content = json.dumps(FRIENDLY_ERROR_JSON).encode('utf-8')
                            last_status = 502
                            last_err_content = content
                            continue

                        if order_id and resp.status == 200:
                            idempotency_store[order_id] = {
                                'timestamp': time.time(),
                                'response': content
                            }
                            # Update order_store if payment_link in content
                            try:
                                resp_json = json.loads(content.decode('utf-8'))
                                plink = resp_json.get('payment_link') or resp_json.get('paymentLink')
                                if plink and order_id.lower() in order_store:
                                    order_store[order_id.lower()]['payment_link'] = plink
                            except Exception:
                                pass
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('X-RateLimit-Limit', str(rl['limit']))
                        self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                        self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                        self.send_header('X-RateLimit-Store', 'dev-memory')
                        self.end_headers()
                        self.wfile.write(content)
                        return
                except urllib.error.HTTPError as e:
                    last_status = e.code
                    last_err_content = json.dumps(FRIENDLY_ERROR_JSON).encode('utf-8')
                    print(f"[VoltEdge DevServer] Target {target_url} returned HTTP {e.code}")
                    continue
                except Exception as e:
                    last_err_content = json.dumps(FRIENDLY_ERROR_JSON).encode('utf-8')
                    print(f"[VoltEdge DevServer] Target {target_url} error: {e}")
                    continue

            # Fallback to local authoritative order store in dev mode if external webhooks are offline
            if order_id and order_id.lower() in order_store:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('X-RateLimit-Limit', str(rl['limit']))
                self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                self.send_header('X-RateLimit-Store', 'dev-memory')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'order_id': order_id,
                    'token': token,
                    'order': order_store[order_id.lower()]
                }).encode())
                return

            self.send_response(last_status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(last_err_content if last_err_content else json.dumps(FRIENDLY_ERROR_JSON).encode('utf-8'))
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
            query = urllib.parse.parse_qs(parsed.query)
            order_id = (query.get('orderId', [''])[0] or query.get('order_id', [''])[0] or query.get('reference', [''])[0]).strip()
            token = (query.get('token', [''])[0] or query.get('lookup_token', [''])[0] or query.get('lookupToken', [''])[0] or query.get('t', [''])[0]).strip()

            if not order_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'BadRequest',
                    'message': 'orderId parameter is required.'
                }).encode())
                return

            if order_id.lower() == 've-20261029-5826':
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'NotFound',
                    'message': 'Order reference not found.'
                }).encode())
                return

            # Always query live webhook first and wait for response
            candidate_urls = [
                f'{ORDER_DETAILS_WEBHOOK}?{parsed.query}'
            ]
            for target_url in candidate_urls:
                try:
                    parsed_host = urllib.parse.urlparse(target_url).netloc
                    req = urllib.request.Request(target_url, headers={
                        'Host': parsed_host,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Origin': 'https://voltedge-tech-accessories.vercel.app'
                    })
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        content = resp.read()
                        try:
                            resp_json = json.loads(content.decode('utf-8'))
                            extracted = resp_json.get('order') or resp_json.get('data') or resp_json
                            if isinstance(extracted, dict):
                                ret_id = str(extracted.get('order_id') or extracted.get('orderId') or extracted.get('trackingCode') or '').strip()
                                if ret_id and ret_id.lower() == order_id.lower() and ret_id.lower() != 've-20261029-5826':
                                    norm = normalize_order(extracted)
                                    if norm:
                                        if token and not norm.get('token'):
                                            norm['token'] = token
                                            norm['lookup_token'] = token
                                        order_store[order_id.lower()] = norm
                                        self.send_response(resp.status)
                                        self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                                        self.send_header('X-RateLimit-Limit', str(rl['limit']))
                                        self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                                        self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                                        self.send_header('X-RateLimit-Store', 'dev-memory')
                                        self.end_headers()
                                        self.wfile.write(content)
                                        return
                        except Exception as e:
                            print('[VoltEdge DevServer] Error parsing webhook response:', e)
                except Exception as e:
                    print(f"[VoltEdge DevServer] Webhook query {target_url} failed:", e)

            # Check local authoritative order store (fallback if webhook offline)
            if order_id.lower() in order_store:
                rec = order_store[order_id.lower()]
                rec_token = rec.get('token') or rec.get('lookup_token') or ''
                if rec_token and (not token or token.lower() != rec_token.lower()):
                    self.send_response(403)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'success': False,
                        'error': 'Forbidden',
                        'message': 'Invalid or missing security lookup token for this order.'
                    }).encode())
                    return

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('X-RateLimit-Limit', str(rl['limit']))
                self.send_header('X-RateLimit-Remaining', str(rl['remaining']))
                self.send_header('X-RateLimit-Reset', str(rl['reset_sec']))
                self.send_header('X-RateLimit-Store', 'dev-memory')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'order': rec
                }).encode())
                return

            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': False,
                'error': 'NotFound',
                'message': f'Order reference "{order_id}" not found.'
            }).encode())
            return

        super().do_GET()

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), DevHandler) as httpd:
        print(f'VoltEdge Dev Server running on http://localhost:{PORT}')
        httpd.serve_forever()
