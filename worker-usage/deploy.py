"""Deploy the usage-log Worker to Cloudflare (needs a token with Workers Scripts + KV edit).

Login hashes are read from src/lib/auth.ts, so run this again after adding a login.
"""
import json, os, re, subprocess, sys

ACCOUNT = 'a52f7c4a0c3ef976883956feaa76c9e4'
NAME = 'shelfscan-usage'
KV_ID = 'f65e1216e1f74fe8a98937eff4176f04'
ADMINS = {'matt'}
HERE = os.path.dirname(os.path.abspath(__file__))
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{NAME}'

auth = open(os.path.join(HERE, '..', 'src', 'lib', 'auth.ts')).read()
logins = {h: u for h, u in re.findall(r"'([0-9a-f]{64})',\s*//\s*(\w+)", auth)}
if not logins:
    sys.exit('no logins found in auth.ts')
metadata = {
    'main_module': 'index.js',
    'compatibility_date': '2025-06-01',
    'bindings': [
        {'type': 'kv_namespace', 'name': 'USAGE', 'namespace_id': KV_ID},
        {'type': 'plain_text', 'name': 'LOGINS', 'text': json.dumps(logins)},
        {'type': 'plain_text', 'name': 'ADMINS', 'text': ','.join(h for h, u in logins.items() if u in ADMINS)},
    ],
}
meta_path = os.path.join(HERE, '.metadata.json')
json.dump(metadata, open(meta_path, 'w'))
r = subprocess.run(['curl', '-sS', '-X', 'PUT', API, '-F', f'metadata=@{meta_path};type=application/json',
                    '-F', f'index.js=@{os.path.join(HERE, "index.js")};type=application/javascript+module'], capture_output=True, text=True)
os.remove(meta_path)
print('upload:', r.stdout[:300])
r = subprocess.run(['curl', '-sS', '-X', 'POST', API + '/subdomain', '-H', 'content-type: application/json', '-d', '{"enabled":true,"previews_enabled":false}'],
                   capture_output=True, text=True)
print('workers.dev:', r.stdout[:200])
print(f'logins: {sorted(logins.values())}, admins: {sorted(ADMINS)}')
