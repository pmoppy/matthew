"""
Sweep Open Food Facts for popular UK convenience products (crisps, snacks,
confectionery, soft drinks) and write a candidate list for the starter library.

Most-scanned products first, UK-tagged, single units only, one front-of-pack
photo each. The output (off_sweep_candidates.json) is then quality-checked by
qc_sweep.py before anything is added to the library.

Usage: python scripts/starter/sweep_off.py
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'ShelfScan/0.1 (starter catalogue builder)'}

# (OFF category tag, app category, how many of the most-scanned to consider, max size g/ml)
QUERIES = [
    ('en:crisps', 'Crisps', 450, 200),
    ('en:popcorn', 'Snacks', 80, 150),
    ('en:salty-snacks', 'Snacks', 350, 200),
    ('en:nuts', 'Snacks', 120, 200),
    ('en:cereal-bars', 'Snacks', 120, 150),
    ('en:biscuits', 'Biscuits', 200, 300),
    ('en:chocolates', 'Confectionery', 400, 250),
    ('en:candies', 'Confectionery', 260, 250),
    ('en:chewing-gum', 'Confectionery', 60, 100),
    ('en:confectioneries', 'Confectionery', 250, 250),
    ('en:energy-drinks', 'Energy', 300, 1000),
    ('en:sodas', 'Soft drinks', 600, 2000),
    ('en:carbonated-drinks', 'Soft drinks', 500, 2000),
    ('en:colas', 'Soft drinks', 200, 2000),
    ('en:lemonade', 'Soft drinks', 150, 2000),
    ('en:fruit-sodas', 'Soft drinks', 200, 2000),
    ('en:iced-teas', 'Soft drinks', 60, 1500),
    ('en:flavoured-waters', 'Water', 120, 2000),
    ('en:sports-drinks', 'Sports', 150, 1000),
    ('en:juice-drinks', 'Soft drinks', 200, 1500),
    ('en:waters', 'Water', 120, 2000),
]

# Brand sweeps for the chiller (catches products OFF files under odd categories).
BRANDS = [
    ('fanta', 'Soft drinks'), ('coca-cola', 'Soft drinks'), ('diet-coke', 'Soft drinks'), ('pepsi', 'Soft drinks'), ('pepsi-max', 'Soft drinks'),
    ('7up', 'Soft drinks'), ('sprite', 'Soft drinks'), ('dr-pepper', 'Soft drinks'), ('tango', 'Soft drinks'), ('rubicon', 'Soft drinks'),
    ('rio', 'Soft drinks'), ('lilt', 'Soft drinks'), ('irn-bru', 'Soft drinks'), ('vimto', 'Soft drinks'), ('oasis', 'Soft drinks'),
    ('ribena', 'Soft drinks'), ('mirinda', 'Soft drinks'), ('schweppes', 'Soft drinks'), ('barr', 'Soft drinks'), ('old-jamaica', 'Soft drinks'),
    ('red-bull', 'Energy'), ('monster-energy', 'Energy'), ('monster', 'Energy'), ('boost', 'Energy'), ('lucozade', 'Energy'), ('relentless', 'Energy'),
    ('rockstar', 'Energy'), ('emerge', 'Energy'), ('euro-shopper', 'Energy'), ('carabao', 'Energy'), ('reign', 'Energy'), ('prime', 'Sports'),
    ('powerade', 'Sports'), ('c4', 'Energy'), ('celsius', 'Energy'), ('tenzing', 'Energy'), ('v', 'Energy'), ('rockstar-energy', 'Energy'),
    ('arizona', 'Soft drinks'), ('snapple', 'Soft drinks'), ('mogu-mogu', 'Soft drinks'), ('ka', 'Soft drinks'), ('levi-roots', 'Soft drinks'),
]

def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


MULTIPACK = re.compile(r'(\d+\s*[x×]\s*\d|\b[x×]\s*\d+\b|\bpack\b|multi\s*-?pack|\d+\s*pk\b|\bcase\b|\bbox of\b|\btub\b|\bselection box\b)', re.I)
# Supermarket / discounter own-label lines are rare in independent convenience stores.
OWN_LABEL = {norm(b) for b in (
    'tesco', 'sainsburys', 'sainsbury', 'asda', 'morrisons', 'waitrose', 'marksspencer', 'ms', 'mands', 'aldi', 'lidl',
    'iceland', 'ocado', 'msfood', 'marksspencerfood', 'mandsfood', 'deluxe', 'snackrite', 'stockwell', 'stockwellco', 'hearty food co', 'specially selected',
    'tastetheDifference'.lower(), 'byesainsburys', 'everydayessentials', 'savers', 'morrisonssavers', 'smartprice',
    'kirkland', 'happyshopper', 'thebest', 'finest', 'tescofinest', 'nomaddoubles', 'cooperative', 'coop', 'thecooperative',
    'irresistible', 'essentialwaitrose', 'sweetcorner', 'dairyfine', 'moser roth', 'mosersroth', 'mcennedy', 'sondey',
    'crusti croc', 'crusticroc', 'pombear', 'snackday', 'fin carre', 'fincarre',
)}
GENERIC = {'company', 'ltd', 'plc', 'uk', 'limited', 'foods', 'food', 'drinks', 'the'}
NOT_UNIT = re.compile(r'(\bhamper\b|\bgift\b|\badvent\b|\btin\b|\bjar\b|\bbag of \d+|\bbulk\b)', re.I)


def get(url):
    err = None
    for _ in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(3)
    raise err


def qty(q):
    q = (q or '').lower().replace(' ', '').replace(',', '.')
    m = re.search(r'(\d+(?:\.\d+)?)(kg|g|ml|cl|l)\b', q)
    if not m:
        return None, None
    v, u = float(m.group(1)), m.group(2)
    amount = v * 1000 if u in ('kg', 'l') else v * 10 if u == 'cl' else v
    unit = 'ml' if u in ('ml', 'cl', 'l') else 'g'
    if amount >= 1000:
        label = f'{amount / 1000:g}{"L" if unit == "ml" else "kg"}'
    else:
        label = f'{amount:g}{unit}'
    return amount, label


def front_url(code, images):
    for key in ['front_en'] + [k for k in images if k.startswith('front_')]:
        meta = images.get(key)
        if isinstance(meta, dict) and meta.get('rev'):
            path = code if len(code) <= 8 else f'{code[0:3]}/{code[3:6]}/{code[6:9]}/{code[9:]}'
            return f'https://images.openfoodfacts.org/images/products/{path}/{key}.{meta["rev"]}.400.jpg'
    return None


def ascii_fold(text):
    """Gullón -> Gullon, Ülker -> Ulker, curly quotes -> straight (file and display safe)."""
    import unicodedata
    text = text.replace('’', "'").replace('‘', "'").replace('–', '-')
    return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()


def smart_case(text):
    """Title-case all-lower/all-upper words but keep brand styling (McCoy's, KP, M&M's)."""
    out = []
    for w in text.split():
        if w.islower() or (w.isupper() and len(w) > 4):
            w = w.capitalize()
        out.append(re.sub(r"(['’])S\b", r"\1s", w))
    return ' '.join(out)


def clean_name(brand, name, label):
    name = re.sub(r'\b\d+(\.\d+)?\s*(kg|g|ml|cl|l|ltr|litre)s?\b', '', name, flags=re.I)
    name = re.sub(r'[^\w&\'\-\. ]', ' ', name)
    words = [w for w in name.split() if w.lower() not in brand.lower().split()]
    nice = smart_case(' '.join(words))
    full = f'{brand} {nice}'.strip()
    return re.sub(r'\s+', ' ', f'{full[:52].strip()} {label}')


def candidate(h, cat, max_size, seen_codes, seen_names):
    """Filtered, named candidate from one search hit, or None."""
    code = h.get('code') or ''
    if not code or code in seen_codes:
        return None
    name = (h.get('product_name_en') or h.get('product_name') or '').strip()
    brands = h.get('brands') or ''
    brands = brands if isinstance(brands, list) else brands.split(',')
    raw_brand = ascii_fold((brands[0] if brands else '').strip())
    name = ascii_fold(name)
    if norm(raw_brand) in OWN_LABEL or any(norm(b) in OWN_LABEL for b in brands):
        return None
    if re.search(r'\b(de|et|avec|mit|und|con|sel|chocolat|ciocolat|leche|lait|sabor|gusto|geschmack)\b', name, re.I):
        return None
    brand = smart_case(raw_brand)
    amount, label = qty(h.get('quantity')) if h.get('quantity') else qty(name)
    if not name or not brand or not amount or amount > max_size or amount < 10:
        return None
    text = f'{name} {h.get("quantity") or ""}'
    if MULTIPACK.search(text) or NOT_UNIT.search(text):
        return None
    img = front_url(code, h.get('images') or {})
    if not img:
        return None
    full = clean_name(brand, name, label)
    rest = norm(full.replace(brand, '', 1).replace(label, ''))
    if len(rest) < 3 or rest in GENERIC or norm(full) in seen_names:
        return None
    seen_codes.add(code)
    seen_names.add(norm(full))
    return {'name': full, 'category': cat, 'code': code, 'image': img, 'scans': h.get('unique_scans_n') or 0}


def main():
    seen_codes, seen_names, out = set(), set(), []
    for tag, cat, cap, max_size in QUERIES:
        got = 0
        for page in range(1, cap // 100 + 2):
            if got >= cap:
                break
            q = f'categories_tags:"{tag}" AND countries_tags:"en:united-kingdom"'
            url = 'https://search.openfoodfacts.org/search?' + urllib.parse.urlencode({
                'q': q, 'page_size': 100, 'page': page, 'sort_by': '-unique_scans_n',
                'fields': 'code,product_name,product_name_en,brands,quantity,images,unique_scans_n',
            })
            try:
                hits = json.loads(get(url)).get('hits', [])
            except Exception as e:  # noqa: BLE001
                print('error', tag, page, e)
                break
            if not hits:
                break
            for h in hits:
                if got >= cap:
                    break
                c = candidate(h, cat, max_size, seen_codes, seen_names)
                if c:
                    out.append({**c, 'off_tag': tag})
                    got += 1
            time.sleep(0.5)
        print(f'{tag:20s} {cat:14s} {got}')
    for brand, cat in BRANDS:
        got = 0
        q = f'brands_tags:"{brand}" AND countries_tags:"en:united-kingdom"'
        for page in (1, 2):
            url = 'https://search.openfoodfacts.org/search?' + urllib.parse.urlencode({
                'q': q, 'page_size': 100, 'page': page, 'sort_by': '-unique_scans_n',
                'fields': 'code,product_name,product_name_en,brands,quantity,images,unique_scans_n',
            })
            try:
                hits = json.loads(get(url)).get('hits', [])
            except Exception as e:  # noqa: BLE001
                print('error', brand, e)
                break
            for h in hits:
                c = candidate(h, cat, 2000, seen_codes, seen_names)
                if c:
                    out.append({**c, 'off_tag': f'brand:{brand}'})
                    got += 1
            time.sleep(0.5)
            if len(hits) < 100:
                break
        print(f'brand:{brand:16s} {cat:14s} {got}')
    json.dump(out, open(os.path.join(HERE, 'off_sweep_candidates.json'), 'w'), indent=1)
    print(len(out), 'candidates')


if __name__ == '__main__':
    main()
