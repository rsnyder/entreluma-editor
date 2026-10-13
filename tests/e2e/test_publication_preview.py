"""A customized publication controls templates, styles and local viewers."""
import base64
import json
from urllib.parse import urlparse, unquote, parse_qs
import pytest
from playwright.sync_api import expect
from conftest import REPO
from test_local_files import png
from test_local_file_transport import EDITOR_CSP
RUNTIME = "https://publication.example/site"


@pytest.mark.parametrize('engine', ['chromium', 'firefox', 'webkit'])
@pytest.mark.parametrize('compatible', [False, True])
def test_publication_overrides_and_local_viewer(playwright, base_url, compatible, engine):
    browser = getattr(playwright,engine).launch()
    page = browser.new_page()
    reads = []
    sha = 'a' * 40
    def github(route):
        url = urlparse(route.request.url)
        if '/commits/' in url.path:
            route.fulfill(json={'sha': sha})
            return
        path = unquote(url.path.split('/contents/', 1)[-1])
        # Other editor panels can inspect a moving branch; preview template
        # reads are the requests pinned to the resolved SHA.
        if parse_qs(url.query).get('ref') == [sha]: reads.append(path)
        overrides = {
            '_config.yml': 'url: https://publication.example\nbaseurl: /site\ntheme: jekyll-theme-chirpy\n',
            'Gemfile.lock': '    jekyll-theme-chirpy (7.6.0)',
            '_layouts/post.html': '---\nlayout: default\n---\n<main id="publication-post">{{ content }}</main>',
            '_layouts/default.html': '<html><head>{% include head.html %}</head><body>{% include sidebar.html %}{{ content }}<script type="module" src="{{ "/assets/js/entreluma.js" | relative_url }}"></script></body></html>',
            '_includes/head.html': '<link rel="stylesheet" href="{{ "/assets/css/entreluma.css" | relative_url }}">',
            '_includes/sidebar.html': '<aside id="publication-sidebar">Publication navigation</aside>',
        }
        file = REPO / 'tests/fixtures/starter' / path
        text = overrides.get(path, file.read_text() if file.is_file() else None)
        if text is None:
            route.fulfill(status=404,json={'message':'Not Found'})
        else:
            route.fulfill(json={'encoding':'base64','content':base64.b64encode(text.encode()).decode(),'sha':'b'*40})
    page.route('https://api.github.com/repos/preview-fixture/site/**', github)
    def runtime(route):
        path = REPO / unquote(urlparse(route.request.url).path).removeprefix('/site/')
        if path.is_file(): route.fulfill(path=path,headers={'Access-Control-Allow-Origin':'*'})
        else: route.fulfill(status=404,body='missing')
    page.route(RUNTIME + '/**', runtime)
    page.route(base_url + '/editor/index.html', lambda route: route.fulfill(path=REPO/'editor/index.html',headers={'Content-Security-Policy':EDITOR_CSP}))
    page.route(RUNTIME + '/assets/css/entreluma.css', lambda route: route.fulfill(content_type='text/css', body='#publication-sidebar { color: rgb(12, 34, 56); }'))
    page.route(RUNTIME + '/assets/entreluma-preview.json', lambda route: route.fulfill(
        status=200 if compatible else 404, json={'schemaVersion':1,'host':1,'localImage':1,'localMap':1},
        headers={'Access-Control-Allow-Origin':'*'}))
    try:
        page.goto(base_url + '/editor/index.html')
        page.locator('#new-doc:not([disabled])').wait_for(timeout=30000)
        page.evaluate(r"""async () => {
          const app = await import('/editor/app.js');
          const doc = await app.modules.store.docs.create({title:'Publication proof', path:'_posts/proof.md',content:'---\ntitle: Publication proof\n---\n\nAn essay.\n'});
          await app.modules.store.docs.update(doc.id,{github:{owner:'preview-fixture',repo:'site',branch:'main',sha:null}});
          await app.openDoc(doc.id);
        }""")
        page.locator('#story-files-btn').click()
        page.locator('#story-files-panel input[type=file]').first.set_input_files({'name':'photo.png','mimeType':'image/png','buffer':png()})
        row = page.locator('.sk-file-row')
        expect(row).to_have_count(1)
        page.once('dialog',lambda dialog:dialog.accept('Publication photo'))
        row.get_by_role('button',name='Insert',exact=True).click()
        page.locator('#story-files-panel').get_by_role('button',name='Close',exact=True).click()
        page.evaluate("async()=>{(await import('/editor/app.js')).setMode('preview');}")
        story = page.frame_locator('#preview-mount iframe.pv-frame')
        expect(story.locator('#publication-sidebar')).to_have_css('color','rgb(12, 34, 56)')
        expect(story.locator('#publication-post')).to_be_visible()
        frame = story.locator('iframe.embed-image').first
        expect(frame).to_have_attribute('src', __import__('re').compile('sk_resource='))
        assert frame.get_attribute('src').startswith(RUNTIME if compatible else base_url)
        viewer = story.frame_locator('iframe.embed-image').first
        frame.scroll_into_view_if_needed()
        viewer.locator('#wrap.is-visible').wait_for(timeout=30000)
        viewer.get_by_role('button',name='Open fullscreen').click()
        story.frame_locator('#entrelumaDialog iframe').locator('#wrap.is-visible').wait_for(timeout=30000)
        source = page.locator('#preview-mount iframe.pv-frame').get_attribute('data-preview-source')
        assert (RUNTIME if compatible else base_url) + '/assets/js/entreluma.js' in source
        diagnostics = page.locator('.pv-diagnostics').inner_text()
        assert ('bundled viewer and host' in diagnostics) == (not compatible)
        assert story.locator('body').evaluate("() => {try {return !!parent.document.body;} catch {return false;}}") is False
        assert all(path in reads for path in ['_layouts/default.html','_includes/head.html','_includes/sidebar.html'])
        before = len(reads)
        page.get_by_role('button',name='Refresh publication preview').click()
        expect(page.get_by_role('button',name='Refresh publication preview')).to_be_enabled(timeout=15000)
        assert len(reads) == before, 'same commit refresh must reuse cached files'
    finally:
        browser.close()
