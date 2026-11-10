"""
Import named product photos from the Cloudflare R2 bucket into the product library.

  python scripts/starter/import_r2.py download   # list the bucket, download named images (cached)
  python scripts/starter/import_r2.py build      # QC, match names, write library photos + report

The file name is the label ("PEPSI MAX CHERRY 500ML.avif"). Files in folders
(e.g. "Barcode Images/") and files named only with a barcode are skipped.
Photos go to library/starter/file/<product>/r2-<etag>.jpg; originals stay in
the bucket. Everything decided here is written to scripts/starter/r2_import.csv
so every library photo can be traced back to its bucket file.

Needs a read-only Cloudflare API token (Workers R2 Storage: Read) for
api.cloudflare.com. In the cloud session it is injected by the network proxy.
"""
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageChops

ACCOUNT = 'a52f7c4a0c3ef976883956feaa76c9e4'
BUCKET = 'topsellers'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/r2/buckets/{BUCKET}/objects'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
LIB = os.path.join(ROOT, 'library', 'starter')
CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'shelfscan', 'r2')
REPORT = os.path.join(HERE, 'r2_import.csv')
NAMES = os.path.join(HERE, 'r2_names.json')  # folder slug -> display name for imported products
CATS = os.path.join(HERE, 'r2_categories.json')  # display name -> category for new products


def curl(url, binary=False):
    r = subprocess.run(['curl', '-sS', '-f', '-m', '120', '--retry', '3', url], capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode()[:200])
    return r.stdout if binary else r.stdout.decode()


def list_bucket():
    keys, cursor = [], None
    while True:
        url = f'{API}?per_page=1000' + (f'&cursor={urllib.parse.quote(cursor)}' if cursor else '')
        r = json.loads(curl(url))
        keys += [{'key': o['key'], 'etag': o['etag'], 'size': o['size']} for o in r['result']]
        info = r.get('result_info') or {}
        if not info.get('is_truncated'):
            return keys
        cursor = info['cursor']


# --- names ---------------------------------------------------------------------------------------

IMAGE_EXT = {'png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif'}
GENERIC = re.compile(r'^(rank\s*\d+|\d+\s*l(tr|itre)?s?\s+bottle|img[_ -]?\d+|image\s*\d*|untitled.*|screenshot.*|whatsapp.*|photo\s*\d*)$', re.I)


def base_name(key):
    """File name without extension and copy markers: 'X 500ML (2).png' -> 'X 500ML'."""
    stem = key.rsplit('.', 1)[0]
    stem = re.sub(r'\s*(\(\d+\)|[-_ ]copy(\s*\d+)?|_\d{1,2})\s*$', '', stem, flags=re.I)
    return re.sub(r'\s+', ' ', stem).strip(' -_')


def skip_reason(key):
    if '/' in key:
        return 'in a folder (barcode images)'
    ext = key.rsplit('.', 1)[-1].lower() if '.' in key else ''
    if ext not in IMAGE_EXT:
        return f'unsupported file type .{ext}' if ext else 'no file type'
    name = base_name(key)
    if re.fullmatch(r'[\d\s_\-()]+', name):
        return 'barcode only'
    if GENERIC.match(name) or len(re.findall(r'[A-Za-z]{2,}', name)) < 2:
        return 'not a product name'
    return None


ACRONYMS = {'bbq', 'kp', 'uk', 'gb', 'xl', 'xxl', 'pk', 'ipa', 'vg', 'cbd', 'tv', 'dj', 'ksa', 'usa', 'pmp', 'pm', 'rtd', 'bt', 'hd', 'xo', 'vsop', 'jd', 'kfc'}


def pretty(name):
    """'WALKERS CHEESE & ONION 150G' -> 'Walkers Cheese & Onion 150g'."""
    out = []
    for w in name.split(' '):
        lw = w.lower()
        if re.fullmatch(r'[\d.,]+(ml|cl|l|ltr|g|kg|pk|s|x)?', lw):  # 500ml, 70cl, 2l, 10pk, 160s
            out.append(lw.replace('ltr', 'L').replace('l', 'L') if re.fullmatch(r'[\d.,]+(l|ltr)', lw) else lw)
        elif lw in ('x',):
            out.append('x')
        elif lw.strip('()') in ACRONYMS:
            out.append(w.upper())
        elif re.search(r'\d', w):
            out.append(w.upper() if len(w) <= 4 else w.capitalize())  # 7UP, 5K, 0.0
        else:
            out.append(re.sub(r"(^|[-'(/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), lw))
    return ' '.join(out)


STOP = {'the', 'and', 'with', 'of', 'a', 'flavour', 'flavor', 'flavoured', 'drink', 'drinks', 'bottle', 'btl', 'pet', 'bag',
        'pouch', 'pmp', 'pm', 'original', 'taste', 'regular', 'classic', 'edition', 'limited', 'energy', 'soft', 'crisps', 'chocolate', 'bar', 'company', 'sharing'}
SYNONYMS = [(r'coca[\s-]?cola', 'coke'), (r'\bsugar free\b', 'sf'), (r'\bsugarfree\b', 'sf'), (r'\bzero sugar\b', 'zero'), (r'\bno added sugar\b', 'nas'),
            (r'\bmcvitie\'?s\b', 'mcvities'), (r'\b7 ?up\b', '7up'), (r'\bdr\.? ?pepper\b', 'drpepper'), (r'\birn[\s-]?bru\b', 'irnbru'),
            (r'\bred ?bull\b', 'redbull'), (r'\bbarrs?\s+(?=irnbru)', ''), (r'\bdiet coke\b', 'coke diet'), (r'\bco[\s-]?op\b', 'coop'), (r'\bkit ?kat\b', 'kitkat'), (r'\bm ?& ?m\'?s\b', 'mandms')]


def size_ml(text):
    """Pack size in a comparable unit, including multipack count: ('ml', 330, 12) / ('g', 150, 1); None when no size."""
    t = text.lower().replace(',', '.')
    pk = re.search(r'(\d+)\s*pk\b|\bx\s*(\d+)\b(?!\s*(ml|cl|l|g|kg))|\b(\d+)\s*x\s*\d', t)
    count = int(next(g for g in pk.groups() if g)) if pk else 1
    one = _unit(t)
    return (one + (count,)) if one else (('pk', count, 1) if pk else None)


def _unit(t):
    m = re.findall(r'(\d+(?:\.\d+)?)\s*(ml|cl|ltr|litre|l|kg|g)\b', t)
    if not m:
        return None
    v, u = m[-1]
    v = float(v)
    if u == 'cl':
        return ('ml', round(v * 10))
    if u in ('l', 'ltr', 'litre'):
        return ('ml', round(v * 1000))
    if u == 'kg':
        return ('g', round(v * 1000))
    return (u, round(v))


def words(text):
    t = text.lower().replace('&', ' and ')
    for a, b in SYNONYMS:
        t = re.sub(a, b, t)
    t = re.sub(r'(\d+(?:\.\d+)?)\s*(ml|cl|ltr|litre|l|kg|g|pk|s)\b', ' ', t)
    return {w for w in re.findall(r"[a-z0-9]+", t) if w not in STOP and not (w.isdigit() and len(w) < 3) and w != 'x'}


def similarity(a, b):
    sa, sb = size_ml(a), size_ml(b)
    if sa != sb:
        return 0.0
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# --- categories for new products ---------------------------------------------------------------------

RULES = [
    ('Tobacco & vapes', r'\b(vape|pod|pods|kit|puffs?|\d+k|e-?liquid|nic(otine)? salt|tobacco|cigarettes?|cigars?|rizla|papers|filters|golden virginia|amber leaf|elf ?bar|lost mary|pixl|ske|crystal bar|hayati|iqos|velo|zyn|snus|nicopods?|nordic spirit|\d+ ?mg|benson|hedges|superkings|kingsize|king size|marlboro|lambert|butler|sterling|rothmans|john player|jps|silk cut|mayfair|chesterfield|richmond|pall mall|camel|l&b|\d+s|elux|vuse|blu)\b'),
    ('Beer & cider', r'\b(lager|beer|ale|ipa|stout|cider|pilsner|peroni|stella|carling|corona|heineken|budweiser|fosters|guinness|thatchers|strongbow|kopparberg|rekorderlig|madri|birra|brewdog|coors|san miguel|desperados|kronenbourg|tennents|carabao lager|shandy|four lo[ck]o|dragon soop|hooch|smirnoff ice)\b'),
    ('Wine', r'\b(wine|merlot|shiraz|malbec|rioja|prosecco|cava|champagne|pinot|sauvignon|chardonnay|cabernet|cab sav|moscato|rose|zinfandel|tempranillo|grigio|blanc|rosso|barefoot|echo falls|19 crimes|i heart)\b'),
    ('Spirits & mixed', r'\b(vodka|gin|rum|whisky|whiskey|tequila|brandy|cognac|liqueur|baileys|jagermeister|sambuca|smirnoff|gordons|bacardi|captain morgan|jack daniels|jameson|glen|disaronno|aperol|schnapps|shochu|seltzer|margarita|marg|mojito|spritz|wkd|vk|quadz|au vodka|served|pina colada|daiquiri|alcopop)\b'),
    ('Energy', r'\b(red ?bull|monster|relentless|rockstar|boost energy|emerge|lucozade (energy|alert)|prime energy|celsius|c4|carabao|lsv energy|reign|ghost energy|tenzing|v energy|mountain dew energy|energy drink)\b'),
    ('Sports', r'\b(lucozade sport|powerade|gatorade|boost sport|prime hydration|isotonic|lsv sport|emerge sport)\b'),
    ('Water', r'\b(water|volvic|evian|highland spring|buxton|harrogate|smartwater|smart water|pellegrino|perrier|aqua|nestle pure life|radnor|strathmore)\b'),
    ('Cola', r'\b(coca[\s-]?cola|coke|pepsi|cola|dr\.? ?pepper)\b'),
    ('Soft drinks', r'\b(fanta|sprite|7 ?up|tango|irn[\s-]?bru|barr|vimto|oasis|ribena|lipton|fever[\s-]?tree|schweppes|rubicon|ka |old jamaica|robinsons|capri[\s-]?sun|fruit shoot|j2o|juice|lemonade|ginger beer|cream soda|squash|cordial|iced tea|ice tea|still|sparkling|soda|tonic|mogu|mountain dew|levi roots|frobishers|innocent|tropicana|purdeys|san benedetto|appletiser|feel good|dandelion|limonata|aranciata|cherry float|smoothie|coconut water)\b'),
    ('Crisps', r'\b(walkers|pringles|doritos|kettle|tyrrell|mccoy\'?s?|monster munch|wotsits|quavers|hula hoops|skips|discos|frazzles|nik naks|squares|golden wonder|space raiders|seabrook|takis|tayto|hunky dorys|sticks|sensations|popchips|pom ?bear|french fries|crisps|transformasnack|chipsticks|cheetos|tortilla|ringos|wheat crunchies|monster munch)\b'),
    ('Biscuits', r'\b(biscuits?|cookies?|digestives?|hobnobs|jaffa cakes|bourbons?|custard creams?|oreo|mcvities|fox\'?s|maryland|ginger nuts|shortbread|rich tea|wafers?|tunnock|penguin|club|blue riband|crackers?|oatcakes?|jacob)\b'),
    ('Confectionery', r'\b(cadbury|galaxy|mars|snickers|twix|bounty|kit ?kat|aero|maltesers|minstrels|milky ?way|magic stars|m ?& ?m|skittles|starburst|haribo|swizzels|fruit pastilles|wine gums|rowntree|nestle (?!pure|shredded)|lindt|ferrero|kinder|toblerone|reese|hershey|chocolate|choc|candy|sweets|gummies|jelly|lollies?|mints?|gum|polo|smarties|yorkie|lion bar|double decker|crunchie|twirl|wispa|dairy milk|buttons|freddo|fudge|toffee|bonbons|candy kittens|maynards|bassetts|bebeto|vidal|fini|sour patch|lily o.?briens|barratt|belts|jelly beans|bubblegum|swizzels|squashies|drumstick|chupa chups|wonka|nerds|sweet shop|sherbe(r)?ts?|sherbety|lollipops?|marshmallows?|liquorice|chewits|millions|nerds|trolli|bazooka|mentos|tic ?tac|extra|airwaves|egg)\b'),
    ('Snacks', r'\b(nuts|peanuts|cashews|pretzels?|popcorn|jerky|biltong|pork scratchings|bombay mix|protein|cereal bar|granola|nakd|nature valley|trek|grenade|fibre one|belvita|rice cakes?|raisins|dried fruit|snack|bar|peperami)\b'),
    ('Hot drinks', r'\b(tea|teabags|tea bags|coffee|nescafe|kenco|douwe|yorkshire tea|pg tips|twinings|latte|cappuccino|hot chocolate|options|horlicks|ovaltine|sachets)\b'),
    ('Dairy & chilled', r'\b(milk|yogurt|yoghurt|cheese|cheddar|butter|cream|ham|chicken|sandwich|wrap|sausage|bacon|eggs|frijj|yazoo|muller|arla|cathedral city|lurpak|flora)\b'),
    ('Frozen & ice cream', r'\b(ice cream|haagen|ben & jerry|magnum|cornetto|calippo|feast|twister|frozen|pizza|chips)\b'),
    ('Household & health', r'\b(wipes|nappies|pampers|tissues|toilet|kitchen roll|bin bags|foil|batteries|bleach|fairy|washing|detergent|shampoo|toothpaste|deodorant|razor|paracetamol|ibuprofen|plasters|lighter|matches|condoms)\b'),
    ('Soft drinks', r'\b\d+(\.\d+)?\s*(ml|l|ltr)\b'),  # any other drink
    ('Grocery', r'.'),
]


def category(name):
    n = name.lower()
    for cat, rx in RULES:
        if re.search(rx, n):
            return cat
    return 'Grocery'


# --- images ------------------------------------------------------------------------------------------


def cache_path(o):
    return os.path.join(CACHE, o['etag'] + '.' + o['key'].rsplit('.', 1)[-1].lower())


def download(objs):
    os.makedirs(CACHE, exist_ok=True)

    def one(o):
        p = cache_path(o)
        if os.path.exists(p) and os.path.getsize(p) == o['size']:
            return None
        try:
            data = curl(f'{API}/{urllib.parse.quote(o["key"], safe="")}', binary=True)
            open(p, 'wb').write(data)
            return None
        except Exception as e:  # noqa: BLE001
            return f'{o["key"]}: {e}'

    with ThreadPoolExecutor(8) as ex:
        errs = [e for e in ex.map(one, objs) if e]
    return errs


def open_image(path):
    im = Image.open(path)
    im.load()
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    return im.convert('RGB')


def trim(im):
    """Crop the plain white/flat border around a pack shot."""
    bg = Image.new('RGB', im.size, im.getpixel((0, 0)))
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 18 else 0)
    box = diff.getbbox()
    if not box:
        return im
    x1, y1, x2, y2 = box
    pw, ph = int((x2 - x1) * 0.03), int((y2 - y1) * 0.03)
    return im.crop((max(0, x1 - pw), max(0, y1 - ph), min(im.width, x2 + pw), min(im.height, y2 + ph)))


def ahash(im):
    g = im.convert('L').resize((16, 16))
    px = list(g.tobytes())
    avg = sum(px) / len(px)
    return ''.join('1' if p > avg else '0' for p in px)


def quality_issue(im):
    w, h = im.size
    if max(w, h) < 150 or min(w, h) < 50:
        return f'too small ({w}x{h})'
    lo, hi = im.convert('L').getextrema()
    if hi - lo < 40:
        return 'blank or almost blank'
    if max(w, h) / max(1, min(w, h)) > 6:
        return 'odd shape (banner/strip, not a pack)'
    return None


def slug(name):
    return re.sub(r'[^A-Za-z0-9]+', '-', name.replace('&', 'and')).strip('-')


def build(objs):
    manifest = json.load(open(os.path.join(LIB, 'manifest.json')))
    existing = [p['name'] for p in manifest['products']]
    rows, groups = [], {}
    for o in objs:
        reason = skip_reason(o['key'])
        if reason:
            if '/' not in o['key']:
                rows.append({'file': o['key'], 'status': 'skipped', 'reason': reason})
            continue
        groups.setdefault(base_name(o['key']).upper(), []).append(o)

    names, cats = {}, {}
    seen_hash = {}
    added_new, added_existing = set(), set()
    for raw, files in sorted(groups.items()):
        display = pretty(raw)
        # Existing product with the same pack size and mostly the same words.
        best, score = None, 0.0
        for e in existing:
            s = similarity(display, e)
            if s > score:
                best, score = e, s
        if score >= 0.75:
            product, how = best, f'existing product ({score:.2f})'
        elif score >= 0.5:
            product, how = display, f'new product, check: maybe same as "{best}" ({score:.2f})'
        else:
            product, how = display, 'new product'
        for o in files:
            p = cache_path(o)
            if not os.path.exists(p):
                rows.append({'file': o['key'], 'status': 'skipped', 'reason': 'download failed'})
                continue
            try:
                im = trim(open_image(p))
            except Exception as e:  # noqa: BLE001
                rows.append({'file': o['key'], 'status': 'skipped', 'reason': f'could not open ({str(e)[:60]})'})
                continue
            issue = quality_issue(im)
            if issue:
                rows.append({'file': o['key'], 'status': 'skipped', 'reason': issue})
                continue
            h = ahash(im)
            dup = seen_hash.get(h)
            if dup and dup[0] == product:
                rows.append({'file': o['key'], 'status': 'skipped', 'reason': 'duplicate photo'})
                continue
            note = how + (f'; same picture as "{dup[1]}"' if dup else '')
            seen_hash.setdefault(h, (product, o['key']))
            im.thumbnail((384, 384))
            folder = slug(product)
            out = os.path.join(LIB, 'file', folder, f'r2-{o["etag"][:12]}.jpg')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            im.save(out, quality=85)
            names[folder] = product
            if product in existing:
                added_existing.add(product)
            else:
                added_new.add(product)
                cats[product] = category(product)
            rows.append({'file': o['key'], 'status': 'added', 'product': product, 'category': cats.get(product, ''), 'library_photo': os.path.relpath(out, LIB), 'note': note})

    # Manifest: add the new photos and products.
    by_name = {p['name']: p for p in manifest['products']}
    for folder, product in names.items():
        d = os.path.join(LIB, 'file', folder)
        imgs = [f'{folder}/{f}' for f in sorted(os.listdir(d))]
        if product in by_name:
            by_name[product]['images'] = sorted(set(by_name[product]['images']) | set(imgs))
        else:
            manifest['products'].append({'name': product, 'images': imgs})
    manifest['products'].sort(key=lambda p: p['name'].lower())
    json.dump(manifest, open(os.path.join(LIB, 'manifest.json'), 'w'), indent=1)
    json.dump(names, open(NAMES, 'w'), indent=1, sort_keys=True)
    json.dump(cats, open(CATS, 'w'), indent=1, sort_keys=True)

    with open(REPORT, 'w', newline='') as f:
        w = csv.DictWriter(f, ['file', 'status', 'product', 'category', 'library_photo', 'reason', 'note'])
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: (r['status'], r.get('product', ''), r['file'])))
    added = [r for r in rows if r['status'] == 'added']
    print(f'added {len(added)} photos: {len(added_new)} new products, {len(added_existing)} existing products got more photos')
    print(f'skipped {len(rows) - len(added)}')
    from collections import Counter
    print(Counter(r['reason'] for r in rows if r['status'] == 'skipped').most_common())
    print(Counter(cats.values()).most_common())
    print('to check:', sum(1 for r in added if 'check' in r.get('note', '')))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    listing = os.path.join(CACHE, 'listing.json')
    if cmd == 'download':
        os.makedirs(CACHE, exist_ok=True)
        objs = list_bucket()
        json.dump(objs, open(listing, 'w'))
        todo = [o for o in objs if not skip_reason(o['key'])]
        print(f'{len(objs)} objects, downloading {len(todo)} named images')
        errs = download(todo)
        print(f'done, {len(errs)} failed', *errs[:10], sep='\n')
    elif cmd == 'build':
        build(json.load(open(listing)))
    else:
        print(__doc__)
