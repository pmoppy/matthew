"""
Build the built-in starter product library (public/starter/).

  * Pack shots come from Open Food Facts (CC BY-SA), picked and checked by hand
    (codes below), then cropped to the pack with the SKU-110K detector so they
    look like shelf crops.
  * Optional extra reference crops from real shelf photos are copied from
    scripts/starter/shelf_crops/<Product>/*.jpg.
  * sales.csv is a research-based starter ranking (see README) – replace it
    with your own EPOS data.

Usage: python scripts/starter/build_starter.py <path to sku110k-yolo11-s640.onnx>
"""
import io, json, os, shutil, sys, time, urllib.request
import numpy as np, onnxruntime as ort
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'starter')
HERE = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'ShelfScan/0.1 (starter catalogue builder)'}

# product -> Open Food Facts barcodes whose front photo shows exactly that SKU
OFF = {
    "Red Bull Energy Drink 250ml": ["9002490205973"],
    "Red Bull Sugarfree 250ml": ["9002490212209", "9002490200220", "9002490215415"],
    "Red Bull Energy Drink 355ml": ["9002490206840", "9002490239565"],
    "Red Bull Tropical Edition 250ml": ["90415845"],
    "Monster Energy Original 500ml": ["5060166690007", "5060335632302", "5060166690380", "5060166694777", "5060896623122"],
    "Monster Ultra White 500ml": ["5060335635174", "5060639126545", "5060947543201", "5060947545724"],
    "Monster Mango Loco 500ml": ["5060639127498", "5060896623214", "5060517888510", "5060639121823"],
    "Monster Pipeline Punch 500ml": ["5060517882976", "5060947546080", "5060639126095", "5060896623368", "5060517883003"],
    "Monster Pacific Punch 500ml": ["5060639122899", "5060751215721", "5060639126682", "5060896622361"],
    "Relentless Original 500ml": ["5060466510210", "5060466510296"],
    "Boost Energy Original 250ml": ["5056079901583"],
    "Lucozade Energy Original 380ml": ["5054267000438", "6164003477475", "5054267014237"],
    "Lucozade Sport Orange 500ml": ["5054267000681"],
    "Lucozade Sport Raspberry 500ml": ["5054267000704"],
    "Coca-Cola Original Taste 500ml": ["5000112663952"],
    "Coca-Cola Original Taste 330ml": ["5000112630633", "40907000", "5449000000996"],
    "Diet Coke 500ml": ["54491496", "4864467414963", "5000112663969"],
    "Coca-Cola Zero Sugar 500ml": ["5000112606386"],
    "Pepsi Max 500ml": ["87170788", "3800747001837"],
    "Pepsi Max 330ml": ["4060800104045", "87170146", "5290047000940"],
    "Fanta Orange 500ml": ["0067000011627", "5000112664249", "5000112644869"],
    "Sprite 500ml": ["5449000205537", "06746500", "5000112658149"],
    "Dr Pepper 500ml": ["5000193034559", "5000112599442", "90494581", "5000112664270"],
    "Irn-Bru 500ml": ["50271511", "5000382112686", "0058997004181", "5000382111856"],
    "Lucozade Alert Cherry Blast 500ml": ["5054267011458"],
    "Lucozade Energy Wild Cherry 380ml": ["5054267009431", "5054267007123"],
    "Lucozade Energy Caribbean Crush 380ml": ["5054267008052", "5054267009424", "5054267010741"],
    "Lucozade Sport Caribbean Burst 500ml": ["5054267009363"],
    "Lucozade Zero Pink Lemonade 380ml": ["5054267004825", "5054267005051", "5054267013322"],
    "Lucozade Energy Pink Lemonade 380ml": ["5054267009455", "5000347010804"],
    "Lucozade Energy Citrus Chill 380ml": ["5054267009288"],
    "Lucozade Energy Apple Blast 380ml": ["5054267009493", "5054267007048"],
    "Lucozade Energy Orange 380ml": ["5054267014220", "5054267010710"],
    "Lucozade Zero Orange 380ml": ["5054267004900"],
    "Lucozade Alert Tropical Burst 500ml": ["5054267011465"],
    "Emerge Energy Original 250ml": ["5000177498858", "5000177449638"],
    "Emerge Impact Sugar Free 250ml": ["5000177481331"],
    "Boost Energy Sugar Free 250ml": ["5056079900524"],
    "Boost Energy Mango 250ml": ["5056079901194"],
    "Boost Energy Red Berry 250ml": ["5000177482116"],
    "Boost Sport Orange 500ml": ["5056079901279"],
    "Prime Hydration Ice Pop 500ml": ["0850040427066", "9781035012084", "6814440827066"],
    "Prime Hydration Strawberry Banana 500ml": ["0810116124015"],
    "Prime Hydration Blue Raspberry 500ml": ["0850040427561", "0850003560670"],
    "Prime Hydration Lemon Lime 500ml": ["6690143041790", "0850003560694"],
    "Prime Hydration Tropical Punch 500ml": ["32085761"],
    "Prime Hydration Meta Moon 500ml": ["0850040427110"],
    "Monster Ultra Gold 500ml": ["5060896623894"],
    "Monster Ultra Rosa 500ml": ["5060896629193", "5060947541245"],
    "Monster Reserve Watermelon 500ml": ["5060896628790"],
    "Monster Khaotic 500ml": ["5060896621760"],
    "Red Bull Red Edition 250ml": ["90446412", "90456657"],
    "Rockstar Juiced Mango Orange Passion 500ml": ["5000382022411"],
    "Relentless Tropical Juiced 500ml": ["5449000956552"],
    "Relentless Mango 500ml": ["5060466517806"],
    "Carabao Green Apple 330ml": ["8855790000783"],
    "Carabao Orange Blast 330ml": ["8855790001155"],
    "Carabao Mixed Berry 330ml": ["8855790001759"],
    "Reign Mang-O-Matic 500ml": ["5060895742510"],
    "Monster Aussie Lemonade 500ml": ["5060947541986"],
    "Monster Lewis Hamilton 500ml": ["5060947546233"],
    "Monster Monarch 500ml": ["5060751213383"],
    "Monster Ultra Watermelon 500ml": ["5060947546141"],
    "Monster Energy Zero Sugar 500ml": ["5060947549715"],
    "Monster Ultra Fiesta 500ml": ["5060608747658"],
    "Monster Ultra White 553ml": ["5060517883560"],
    "Monster The Doctor 500ml": ["5060335632777"],
    "Monster Hydrosport 650ml": ["5060639123964"],
    "Red Bull Energy Drink 473ml": ["9002490210991"],
    "Red Bull Coconut Edition 250ml": ["90435348"],
    "Red Bull Winter Edition 250ml": ["90457432"],
    "Rockstar XD Power 500ml": ["5000382108870"],
    "Reign Peach Fizz 500ml": ["5060608748402"],
    "Tenzing Pineapple & Passionfruit 330ml": ["5060444850093"],
    "Tenzing Raspberry & Yuzu 250ml": ["5060444850208"],
    "Tenzing Original 250ml": ["96126080", "5060444850116"],
    "Tenzing Raspberry & Yuzu 330ml": ["5060444850802"],
    "Tenzing Lime & Mint 330ml": ["5060444851038"],
    "Lucozade Sport Zero Passion Fruit 500ml": ["5054267012509"],
    "Lucozade Energy Orange 330ml": ["5054267001299"],
    "Lucozade Energy Original 900ml": ["10542675"],
    "Prime Hydration Strawberry Watermelon 500ml": ["0850003560991"],
    "Prime Hydration KSI Orange & Mango 500ml": ["0810116120765"],
    "Prime Hydration Orange 500ml": ["0850003560700"],
    "Prime Energy Tropical Punch 330ml": ["0850040427554"],
    "Prime Hydration Grape 500ml": ["5999036108420"],
    "Coca-Cola Original Taste 1.25L": ["5449000267412"],
    "Coca-Cola Original Taste 1.5L": ["5449000000439"],
    "Coca-Cola Original Taste 150ml": ["54491014"],
    "Coca-Cola Original Taste 1.75L": ["5449000130389"],
    "Diet Coke 330ml": ["5449000053879"],
    "Coca-Cola Zero Sugar 2L": ["5449000669902"],
    "Dr Pepper Zero 500ml": ["5449000121134"],
    "Coca-Cola Zero Sugar Vanilla 500ml": ["5449000226457"],
    "Diet Coke 1.75L": ["5000112583915"],
    "Diet Coke Caffeine Free 500ml": ["54492134"],
    "Coca-Cola Zero Sugar Cherry 500ml": ["5449000214744"],
    "Sprite 1.75L": ["5449000132505"],
    "Pepsi Max Cherry 500ml": ["4060800172396"],
    "Pepsi Max 1.25L": ["4060800178008"],
    "Pepsi Regular 330ml": ["4060800308399"],
    "Pepsi Max Cherry 2L": ["4060800166531"],
    "Pepsi Regular 2L": ["4060800001771"],
    "Pepsi Regular 500ml": ["87170801"],
    "Pepsi Max 250ml": ["4060800177155"],
    "Pepsi Max 600ml": ["4060800134943"],
    "Pepsi Max Lime 500ml": ["4060800306982"],
    "Pepsi Max Cherry 330ml": ["4060800173621"],
    "Pepsi Max Raspberry 330ml": ["4060800302694"],
    "Pepsi Max Raspberry 600ml": ["4060800302724"],
    "Fanta Orange 330ml": ["5449000011527"],
    "Fanta Fruit Twist 500ml": ["54493957"],
    "Fanta Fruit Twist 2L": ["5449000042156"],
    "Fanta Raspberry Zero 250ml": ["5000112519877"],
    "Sprite 330ml": ["5449000014535"],
    "Sprite 2L": ["5000112575071"],
    "7UP Lemon & Lime 330ml": ["4060800304360"],
    "7UP Lemon & Lime 500ml": ["4060800109781"],
    "Tango Strawberry & Watermelon Sugar Free 1.5L": ["5010102242067"],
    "Tango Orange 1.5L": ["5010102003422"],
    "Tango Dark Berry Sugar Free 330ml": ["5010102243125"],
    "Tango Orange 2L": ["5010102003804"],
    "Tango Dark Berry Sugar Free 2L": ["5010102243088"],
    "Tango Apple 330ml": ["5010102003507"],
    "Tango Mango Sugar Free 500ml": ["5010102341609"],
    "Irn-Bru Xtra 2L": ["5000382102496"],
    "Irn-Bru Sugar Free 2L": ["50382811"],
    "Irn-Bru Xtra 500ml": ["5000382112723"],
    "Irn-Bru 2L": ["5000382023197"],
    "Irn-Bru Xtra Wild Berry Slush 330ml": ["5000382122401"],
    "Dr Pepper 330ml": ["5010102100015"],
    "Dr Pepper 2L": ["5015672006903"],
    "Rubicon Still Mango 1L": ["5011898007014"],
    "Rubicon Still Lychee 288ml": ["5011898002125"],
    "Rubicon Still Guava 1L": ["5000382104957"],
    "Rubicon Still Passion Fruit 288ml": ["5011898002620"],
    "Rubicon Sparkling Mango 330ml": ["5000382107712"],
    "Rubicon Sparkling Mango 500ml": ["5000382112464"],
    "Rubicon Still Lychee 1L": ["5000382039495"],
    "Rubicon Still Watermelon 1L": ["5000382109433"],
    "Rubicon Still Pineapple 288ml": ["5000382113836"],
    "Rubicon Light & Fruity Mango Lime & Mint 1L": ["5000382102748"],
    "Rubicon Sparkling Raspberry & Pineapple 330ml": ["5000382112600"],
    "Rubicon Spring Black Cherry & Raspberry 330ml": ["5000382120285"],
    "Rubicon Raw Energy 500ml": ["5000382111429"],
    "Oasis Blackcurrant & Apple 500ml": ["5449000122650"],
    "Oasis Citrus Punch 375ml": ["90490125"],
    "Oasis Citrus Punch 500ml": ["5000112630084"],
    "Ribena Blackcurrant 250ml": ["5054267006102"],
    "Ribena Blackcurrant 500ml": ["5054267002333", "5054267007895"],
    "Ribena Light Pineapple & Passion Fruit 500ml": ["5054267013193"],
    "Ribena Strawberry 250ml": ["5054267006119"],
    "Ribena Blackcurrant 1L": ["5000347007590"],
    "Ribena Sparkling Raspberry 330ml": ["5054267010031"],
    "Vimto Fizzy Zero 330ml": ["5010438007767"],
    "Vimto Fizzy 330ml": ["5010438020186"],
    "Vimto Zero 500ml": ["5010438011924"],
    "Vimto Orange Strawberry & Lime 2L": ["5010438017544"],
    "Vimto Fizzy 2L": ["5010438017346"],
    "Vimto Energy 500ml": ["5010438021428"],
    "Schweppes Slimline Lemonade 2L": ["5000193730574"],
}


def get(url):
    for i in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2)
    raise err


def detect_main_pack(sess, im):
    """Largest confident box near the image centre (the product being photographed)."""
    S = 640
    s = S / max(im.size)
    r = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))))
    t = Image.new('RGB', (S, S), (114, 114, 114))
    t.paste(r, (0, 0))
    x = np.asarray(t, dtype=np.float32).transpose(2, 0, 1)[None] / 255
    o = sess.run(None, {'images': x})[0][0]
    best, best_score = None, 0
    cx0, cy0 = r.width / 2, r.height / 2
    for cx, cy, w, h, c in o.T:
        if c < 0.4:
            continue
        x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
        centred = x1 < cx0 < x2 and y1 < cy0 < y2
        score = w * h * c * (2 if centred else 1)
        if score > best_score:
            best, best_score = (x1, y1, x2, y2), score
    if best is None:
        return im
    # Only trust a box that covers a good part of the photo; small boxes are
    # usually a logo or label fragment rather than the whole pack.
    bx1, by1, bx2, by2 = best
    if (bx2 - bx1) * (by2 - by1) < 0.18 * r.width * r.height or (by2 - by1) < 0.45 * r.height:
        return im
    x1, y1, x2, y2 = (v / s for v in best)
    pw, ph = (x2 - x1) * 0.04, (y2 - y1) * 0.03
    return im.crop((max(0, x1 - pw), max(0, y1 - ph), min(im.width, x2 + pw), min(im.height, y2 + ph)))


def save(im, path):
    im = im.convert('RGB')
    im.thumbnail((512, 512))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, quality=88)


def main(detector):
    sess = ort.InferenceSession(detector)
    shutil.rmtree(os.path.join(OUT, 'file'), ignore_errors=True)
    attribution = []
    for product, codes in OFF.items():
        for code in codes:
            meta = json.loads(get(f'https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=image_front_url'))
            url = meta['product']['image_front_url']
            im = Image.open(io.BytesIO(get(url))).convert('RGB')
            save(detect_main_pack(sess, im), os.path.join(OUT, 'file', product, f'off-{code}.jpg'))
            attribution.append(f'- {product}: https://world.openfoodfacts.org/product/{code}')
        print('✓', product)
    crops = os.path.join(HERE, 'shelf_crops')
    for product in sorted(os.listdir(crops)) if os.path.isdir(crops) else []:
        for f in sorted(os.listdir(os.path.join(crops, product))):
            shutil.copy(os.path.join(crops, product, f), os.path.join(OUT, 'file', product, f) if os.path.isdir(os.path.join(OUT, 'file', product)) else _mk(os.path.join(OUT, 'file', product), f))
    shutil.copy(os.path.join(HERE, 'sales.csv'), os.path.join(OUT, 'file', 'sales.csv'))
    products = []
    for p in sorted(os.listdir(os.path.join(OUT, 'file'))):
        d = os.path.join(OUT, 'file', p)
        if os.path.isdir(d):
            products.append({'name': p, 'images': [f'{p}/{f}' for f in sorted(os.listdir(d))]})
    manifest = {'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'products': products, 'sales': 'sales.csv', 'detector': None}
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    with open(os.path.join(OUT, 'ATTRIBUTION.md'), 'w') as f:
        f.write('# Starter library image credits\n\nPack shots from [Open Food Facts](https://world.openfoodfacts.org) contributors, '
                'licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), cropped. Files named `shelf-*.jpg` are '
                'crops from field photos.\n\n' + '\n'.join(attribution) + '\n')
    print(len(products), 'products,', sum(len(p['images']) for p in products), 'images')


def _mk(d, f):
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f)


if __name__ == '__main__':
    main(sys.argv[1])
