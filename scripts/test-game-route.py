"""Compare real game WebSocket RTT over DNS and CloudflareSpeedTest IPs.

Requires websocket-client: python -m pip install websocket-client
Only /api/ping is sent; no game is created, joined or modified.
"""
import argparse
import csv
import ipaddress
import json
import math
from pathlib import Path
import socket
import ssl
import statistics
import time

try:
    import websocket
except ImportError:
    raise SystemExit('Install the test dependency: python -m pip install websocket-client')


def candidates(path, limit):
    # Column order is stable in CFST, independent of localized header labels.
    with Path(path).open(encoding='utf-8-sig', newline='') as source:
        rows = csv.reader(source)
        next(rows, None)
        valid = []
        for row in rows:
            try:
                ip = str(ipaddress.ip_address(row[0]))
                sent, received = int(row[1]), int(row[2])
                loss, latency, speed = map(float, row[3:6])
                if sent > 0 and received == sent and loss == 0 and latency > 0 and speed > 0:
                    valid.append((latency, ip))
            except (ValueError, IndexError):
                continue
    return list(dict.fromkeys(ip for _, ip in sorted(valid)))[:limit]


def measure(host, ip, game, room, count, timeout):
    result = {'route': ip or 'system-dns', 'samples_ms': [], 'failed_samples': 0}
    raw = tls = ws = None
    try:
        start = time.perf_counter()
        raw = socket.create_connection((ip or host, 443), timeout=timeout)
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        result.update(peer_ip=raw.getpeername()[0], tcp_ms=round((time.perf_counter()-start)*1000, 2))
        # Keep the actual domain as TLS SNI, certificate hostname and HTTP Host.
        tls = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        ws = websocket.create_connection(
            f'wss://{host}/realtime/{game}/{room}', socket=tls,
            origin=f'https://{host}', timeout=timeout,
        )
        result['cf_ray'] = ws.getheaders().get('cf-ray', '')
        for index in range(count+1):
            start = time.perf_counter()
            ws.send(json.dumps({'id': index+1, 'path': '/api/ping', 'body': {}}))
            response = json.loads(ws.recv())
            if response.get('id') != index+1 or not response.get('ok'):
                raise ValueError('Unexpected game ping response')
            elapsed = round((time.perf_counter()-start)*1000, 2)
            if index == 0:
                result['warmup_ms'] = elapsed
            else:
                result['samples_ms'].append(elapsed)
            time.sleep(.2)
        samples = sorted(result['samples_ms'])
        result.update(median_ms=round(statistics.median(samples), 2),
                      p90_ms=samples[math.ceil(.9*len(samples))-1], max_ms=max(samples))
    except (OSError, ValueError, websocket.WebSocketException) as error:
        result['error'] = f'{type(error).__name__}: {error}'[:250]
        result['failed_samples'] = count-len(result['samples_ms'])
    finally:
        if ws:
            try:
                ws.close(timeout=1)
            except OSError:
                pass
        elif tls:
            tls.close()
        elif raw:
            raw.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True, help='The existing HTTPS website hostname')
    parser.add_argument('--csv', default='result.csv')
    parser.add_argument('--limit', type=int, default=6)
    parser.add_argument('--samples', type=int, default=10)
    parser.add_argument('--timeout', type=float, default=5)
    parser.add_argument('--game', choices=['billiards', 'go', 'mahjong'], default='billiards')
    parser.add_argument('--room', default='100', help='Use the same room for every route')
    parser.add_argument('--ip', action='append', help='Test these IPs instead of CSV candidates')
    parser.add_argument('--output', default='artifacts/game-route-results.json')
    args = parser.parse_args()
    if not 1 <= args.samples <= 100 or not 1 <= args.limit <= 20 or not 0 < args.timeout <= 30:
        parser.error('Invalid sample count, candidate limit or timeout')
    if not args.room.isdigit() or not 100 <= int(args.room) <= 999:
        parser.error('Room must be 100..999')
    if any(c in args.host for c in '/:@?#\\\r\n') or not args.host:
        parser.error('Use a hostname only')
    ips = [str(ipaddress.ip_address(ip)) for ip in args.ip] if args.ip else candidates(args.csv, args.limit)
    results = []
    # Measure DNS again after the candidate set to expose temporal variation.
    for ip in [None, *ips, None]:
        result = measure(args.host, ip, args.game, args.room, args.samples, args.timeout)
        results.append(result)
        print(json.dumps(result, ensure_ascii=True), flush=True)
    available = [r for r in results if r['route'] != 'system-dns' and 'median_ms' in r and not r.get('error')]
    best = min(available, key=lambda r: (r['p90_ms'], r['median_ms'])) if available else None
    report = {'host': args.host, 'game': args.game, 'room': args.room,
              'measured_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'recommended_ip': best['route'] if best else None, 'results': results}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('Recommended candidate:', report['recommended_ip'], '| report:', output)
    if not best:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
