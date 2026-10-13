"""Verify OSM identification and preview isolation without downloading OSM tiles.
Run after tools/prepare-framework.mjs; requires Playwright and its three browsers.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 for engine in ['chromium','firefox','webkit']:
  browser=getattr(p,engine).launch();ctx=browser.new_context();page=ctx.new_page();seen=[]
  def local(route):
   from urllib.parse import urlparse
   path=urlparse(route.request.url).path
   if path=='/editor/':
    route.fulfill(content_type='text/html',headers={'Referrer-Policy':'no-referrer'},body='<iframe id="preview" sandbox="allow-scripts" src="/assets/components/map.html?center=37,-110&zoom=5&entreluma_tile_bridge=1" width="600" height="400"></iframe><script type="module">import {attachMapTiles} from "/editor/map-tiles.js"; attachMapTiles(document.querySelector("iframe"));</script>')
   else:
    f=root/path.lstrip('/')
    if f.is_file():route.fulfill(path=f,headers={'Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*'})
    else:route.fulfill(status=404)
  def tiles(route):
   seen.append(route.request.all_headers().get('referer'));route.fulfill(status=200,content_type='image/png',headers={'Access-Control-Allow-Origin':'*'},body=__import__('base64').b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'))
  ctx.route('https://editor.example/**',local)
  ctx.route('https://*.tile.openstreetmap.org/**',tiles)
  ctx.route('https://tile.openstreetmap.org/**',tiles)
  page.goto('https://editor.example/editor/')
  for _ in range(100):
   if seen:break
   page.wait_for_timeout(200)
  print(engine, 'origin-only referrers verified', flush=True)
  assert seen and all(x=='https://editor.example/' for x in seen), seen
  viewer=page.frames[1]
  viewer.wait_for_function("Array.from(document.querySelectorAll('img.leaflet-tile')).some(i=>i.naturalWidth>0)")
  assert viewer.evaluate("(()=>{try {parent.document.body;return false} catch{return true}})()")
  before=len(seen)
  viewer.evaluate("top.postMessage({kind:'entreluma-osm-tile', id:'invalid', z:19, x:-1, y:0}, '*')")
  page.evaluate("dispatchEvent(new MessageEvent('message', {source:window, data:{kind:'entreluma-osm-tile',id:'outside',z:0,x:0,y:0}}))")
  page.wait_for_timeout(200)
  assert len(seen)==before, 'Invalid or unrelated frame request reached OSM'
  print(engine, 'tile rendered, sandbox retained, invalid requests rejected',flush=True)
  browser.close()
