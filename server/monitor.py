#!/usr/bin/env python3
"""Minute sampler, conservative interface accounting, web-port budget guard.

Only aggregate public data is uploaded. Credentials live outside the repository.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Shanghai')
TABLE = 'website_budget'
PORTS = '80, 443, 8788'


def load_env(path):
    for line in Path(path).read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            name, value = line.split('=', 1)
            os.environ.setdefault(name.strip(), value.strip())


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix('.tmp')
    with temp.open('w') as out:
        os.chmod(temp, 0o600)
        json.dump(value, out, separators=(',', ':'))
        out.flush()
        os.fsync(out.fileno())
    os.replace(temp, path)


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=10, **kwargs).stdout


def account(previous, tx, boot, now, boot_started):
    """First run includes boot bytes only when boot belongs to this month."""
    day, month = now.strftime('%Y-%m-%d'), now.strftime('%Y-%m')
    state = dict(previous)
    if not previous:
        delta = tx if boot_started.strftime('%Y-%m') == month else 0
        state.update(month=month, day=day, monthlyBytes=0, dailyBytes=0,
                     coverageStartedAt=(boot_started if delta else now).isoformat(), notified={}, notificationDay=day, attempts=0)
        same_day_boot = boot_started.strftime('%Y-%m-%d') == day
    else:
        delta = max(0, tx - previous['tx']) if previous.get('boot') == boot else tx
        same_day_boot = True
    if state.get('month') != month:
        state.update(month=month, monthlyBytes=0, protected=False, guardBoot=None, notified={})
    if state.get('day') != day:
        state.update(day=day, dailyBytes=0)
    state['monthlyBytes'] += delta
    if same_day_boot:
        state['dailyBytes'] += delta
    elapsed = max(1, now.timestamp() - previous.get('sampleTime', now.timestamp()))
    rate = delta / elapsed if previous else 0
    state.update(tx=tx, boot=boot, sampleTime=now.timestamp())
    state['recent'] = [x for x in state.get('recent', []) if now.timestamp()-x[0] < 300]
    state['recent'].append([now.timestamp(), delta if previous else 0])
    return state, rate


def guard_rules(interface, budget, used, replace=False, latched=False):
    if not re.fullmatch(r'[\w.-]{1,32}', interface):
        raise ValueError('Invalid interface')
    # All egress counts toward the quota. Only public HTTP/game responses drop.
    # SSH, outgoing notification/API requests, cloud agents and DNS remain usable.
    prefix = f'delete table inet {TABLE}\n' if replace else ''
    prefix += f'''table inet {TABLE} {{
 quota month {{ over {int(budget)} bytes used {int(used)} bytes; }}
 chain blocked_web {{
  tcp sport {{ {PORTS} }} drop
  udp sport 443 drop
 }}
 chain output {{
  type filter hook output priority 10; policy accept;
  oifname "{interface}" quota name "month" jump blocked_web
'''
    if latched:
        prefix += f'  oifname "{interface}" jump blocked_web\n'
    return prefix + ' }\n}\n'


def ensure_guard(state, interface, budget, check_only=False):
    exists = subprocess.run(['nft', 'list', 'table', 'inet', TABLE], capture_output=True).returncode == 0
    if exists and state.get('guardBoot') == state['boot'] and state.get('guardMonth') == state['month']:
        details = json.loads(run(['nft', '-j', 'list', 'quota', 'inet', TABLE, 'month']))
        quota = next(x['quota'] for x in details['nftables'] if 'quota' in x)
        if quota.get('used', 0) >= budget:
            state['protected'] = True
        return
    rules = guard_rules(interface, budget, state['monthlyBytes'], exists, state.get('protected', False))
    run(['nft', '-c', '-f', '-'], input=rules)
    if not check_only:
        run(['nft', '-f', '-'], input=rules)
        state.update(guardBoot=state['boot'], guardMonth=state['month'])


def machine_snapshot(state, rate, now):
    mem = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        mem[key] = int(value.split()[0]) * 1024
    cpu = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    total, idle = sum(cpu), cpu[3] + cpu[4]
    last = state.get('cpu', [total, idle])
    percent = 100 * (1 - (idle-last[1])/max(1, total-last[0])) if total > last[0] else 0
    state['cpu'] = [total, idle]
    disk = shutil.disk_usage('/')
    try:
        with urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=2) as response:
            game = json.load(response)
        game = {'online': bool(game.get('ok')), 'connections': game.get('connections', 0), 'rooms': game.get('rooms', 0)}
    except Exception:
        game = {'online': False, 'connections': 0, 'rooms': 0}
    budget = int(os.environ.get('MONTHLY_BUDGET_BYTES', '1000000000'))
    return {'updatedAt': now.isoformat(), 'cpuPercent': round(max(0, min(100, percent)), 1),
            'memoryTotal': mem['MemTotal'], 'memoryUsed': mem['MemTotal']-mem['MemAvailable'],
            'diskUsed': disk.used, 'diskTotal': disk.total,
            'uptimeSeconds': int(float(Path('/proc/uptime').read_text().split()[0])),
            'traffic': {'month': state['month'], 'monthlyBytes': state['monthlyBytes'], 'dailyBytes': state['dailyBytes'],
                        'budgetBytes': budget, 'outBytesPerSecond': round(rate), 'protected': bool(state.get('protected')),
                        'coverageStartedAt': state['coverageStartedAt']}, 'game': game}


def message(kind, snapshot):
    t = snapshot['traffic']
    gb = lambda n: f'{n/1e9:.3f} GB'
    titles = {'test': '测试通知｜服务器流量监控已接通', 'daily': f'服务器日报｜今日出站 {gb(t["dailyBytes"])}',
              'warning': f'⚠ 流量预警｜本月已用 {t["monthlyBytes"]/t["budgetBytes"]:.0%}',
              'burst': '⚠ 流量异常｜近5分钟出站超过50 MB',
              'protected': '🚨 流量保护｜本月额度已达，公网网站响应已限制'}
    action = '已限制网站和游戏的公网响应；SSH、通知保留，Cloudflare 音乐不受影响。' if t['protected'] else '服务仍在运行。'
    cost = os.environ.get('TRAFFIC_PRICE_PER_GB', '')
    estimated = f'¥{t["monthlyBytes"]/1e9*float(cost):.2f}' if cost else '未配置流量单价，暂不估算'
    text = (f'统计时间：{snapshot["updatedAt"]}\n\n今日出站：{gb(t["dailyBytes"])}\n\n本月累计：{gb(t["monthlyBytes"])}'
            f'\n\n月度额度：{gb(t["budgetBytes"])}，已用 {t["monthlyBytes"]/t["budgetBytes"]:.1%}'
            f'\n\n流量预估费用：{estimated}\n\nCPU：{snapshot["cpuPercent"]}%'
            f'｜内存：{snapshot["memoryUsed"]/1e6:.0f}/{snapshot["memoryTotal"]/1e6:.0f} MB'
            f'\n\n磁盘：{snapshot["diskUsed"]/1e9:.1f}/{snapshot["diskTotal"]/1e9:.1f} GB'
            f'\n\n游戏连接：{snapshot["game"]["connections"]} 个\n\n处理结果：{action}'
            '\n\n说明：服务器网卡出站统计，可能包含不计费内网通信；不是阿里云账单。Cloudflare 音乐流量不计入。')
    if kind == 'test':
        text = '这是一条接入测试消息，未触发停机或超额。\n\n' + text
    return titles[kind], text


def send_notice(kind, snapshot, state, state_file, now):
    day = now.strftime('%Y-%m-%d')
    if state.get('notificationDay') != day:
        state.update(notificationDay=day, attempts=0)
    # At most five attempts/day; reserve the fifth for protection/test messages.
    if state.get('attempts', 0) >= (5 if kind in ('protected', 'test') else 4):
        return False
    key = os.environ.get('SERVERCHAN_SENDKEY', '')
    if not re.fullmatch(r'SCT[A-Za-z0-9]+', key):
        raise RuntimeError('Push credential missing or invalid')
    title, body = message(kind, snapshot)
    state['attempts'] = state.get('attempts', 0) + 1
    state['noticeAttemptAt'] = now.timestamp()
    save_json(state_file, state)
    request = urllib.request.Request('https://sctapi.ftqq.com/' + key + '.send',
                                     data=urllib.parse.urlencode({'title': title, 'desp': body}).encode(), method='POST')
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            result = json.load(response)
        if result.get('code') != 0:
            print('Notification rejected by provider; credential and response body omitted.')
            return False
        print('Notification accepted by ServerChan:', kind)
        return True
    except Exception:
        print('Notification failed; no automatic immediate retry, details omitted.')
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', default='/etc/website-monitor.env')
    parser.add_argument('--test-notification', action='store_true')
    parser.add_argument('--check-guard', action='store_true')
    args = parser.parse_args()
    load_env(args.env)
    state_dir = Path(os.environ.get('MONITOR_STATE_DIR', '/var/lib/website-monitor'))
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (state_dir/'lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    path = state_dir/'state.json'
    previous = read_json(path, {})
    now = dt.datetime.now(TZ)
    interface = os.environ.get('MONITOR_INTERFACE', 'eth0')
    if not re.fullmatch(r'[\w.-]{1,32}', interface):
        raise ValueError('Invalid interface')
    tx = int(Path(f'/sys/class/net/{interface}/statistics/tx_bytes').read_text())
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    uptime = float(Path('/proc/uptime').read_text().split()[0])
    state, rate = account(previous, tx, boot, now, now-dt.timedelta(seconds=uptime))
    budget = int(os.environ.get('MONTHLY_BUDGET_BYTES', '1000000000'))
    if budget <= 0:
        raise ValueError('Invalid monthly budget')
    if state['monthlyBytes'] >= budget:
        state['protected'] = True
    ensure_guard(state, interface, budget, args.check_guard)
    if args.check_guard:
        print('Budget guard syntax valid; no firewall changes applied.')
        return
    snapshot = machine_snapshot(state, rate, now)
    save_json(path, state)
    save_json(state_dir/'public.json', snapshot)
    # Upload only the whitelisted snapshot, never env/state or command output.
    endpoint = os.environ.get('STATUS_PUSH_URL', '')
    if endpoint:
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme != 'https' or parsed.path != '/api/status/ingest' or parsed.username or parsed.password:
            raise ValueError('Invalid status endpoint')
        try:
            req = urllib.request.Request(endpoint, data=json.dumps(snapshot).encode(), method='POST',
                headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                         'User-Agent': 'website-status-monitor/1.0',
                         'Authorization': 'Bearer '+os.environ['SERVER_STATUS_TOKEN']})
            with urllib.request.urlopen(req, timeout=12) as response:
                if response.status != 200:
                    raise RuntimeError('Status upload rejected')
        except Exception:
            print('Public status upload failed; local accounting and guard remain active.')
    notices = state.setdefault('notified', {})
    if args.test_notification:
        if notices.get('test'):
            print('Test already accepted previously; not sending a duplicate.')
        elif send_notice('test', snapshot, state, path, now):
            notices['test'] = True
    else:
        kind = None
        if state.get('protected') and not notices.get('protected'):
            kind = 'protected'
        elif state['monthlyBytes'] >= budget*.8 and not notices.get('warning'):
            kind = 'warning'
        elif sum(x[1] for x in state['recent']) >= 50_000_000 and not notices.get('burst:'+state['day']):
            kind = 'burst'
        elif now.hour >= 22 and not notices.get('daily:'+state['day']):
            kind = 'daily'
        interval = 60 if kind == 'protected' else 3600
        if kind and now.timestamp()-state.get('noticeAttemptAt', 0) >= interval:
            if send_notice(kind, snapshot, state, path, now):
                notices[kind if kind in ('warning', 'protected') else kind+':'+state['day']] = True
    save_json(path, state)
    print('Monitor sampled; public upload attempted; web quota guard active.')


if __name__ == '__main__':
    main()
