// skrender.js needs classic-script globals (liquidjs/markdownit/jsyaml)
// BEFORE import — the harness loads them below via loadClassicLibs().
// Served from the repo's committed CDN fixtures (tests/render/fixtures/cdn)
// so this suite stays hermetic — same files the render harness pins.
const CLASSIC_LIBS = [
  '/tests/render/fixtures/cdn/npm/liquidjs@10.27.1/dist/liquid.browser.min.js',
  '/tests/render/fixtures/cdn/npm/markdown-it@14.3.0/dist/markdown-it.min.js',
  '/tests/render/fixtures/cdn/npm/markdown-it-footnote@3.0.3/dist/markdown-it-footnote.min.js',
  '/tests/render/fixtures/cdn/npm/markdown-it-sub@1.0.0/dist/markdown-it-sub.min.js',
  '/tests/render/fixtures/cdn/npm/markdown-it-sup@1.0.0/dist/markdown-it-sup.min.js',
  '/tests/render/fixtures/cdn/npm/js-yaml@4.3.0/dist/js-yaml.min.js',
];
async function loadClassicLibs() {
  if (window.liquidjs && window.markdownit && window.jsyaml) return;
  for (const src of CLASSIC_LIBS) {
    await new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.onload = res; el.onerror = rej;
      document.head.append(el);
    });
  }
}


describe('skrender: frameworkAssetOrigin rewrite (central editor policy)', () => {
  it('borrows compiled theme assets for an undeployed repository without moving its images or custom CSS', async () => {
    await loadClassicLibs();
    const { renderPost } = await import('/assets/js/skrender.js');
    const context = {
      config: {}, assetOrigin: 'https://editor.example', baseurl: '',
      themeAssetOrigin: 'https://entreluma.org',
      rawContentBase: 'https://raw.githubusercontent.com/o/r/main/',
      resolveFile: async p => p === '_layouts/nolayout.html' ? '{{ content }}' : null,
    };
    const content = '---\nlayout: nolayout\n---\n' +
      '<link rel="stylesheet" href="/assets/css/jekyll-theme-chirpy.css">\n' +
      '<script src="/assets/js/dist/theme.min.js"></script>\n' +
      '<link rel="stylesheet" href="/assets/css/custom.css">\n' +
      '<img src="/assets/posts/local/pic.png">';
    const { html } = await renderPost({ content, path: '_posts/test.md', context });
    assert.ok(html.includes('https://entreluma.org/assets/css/jekyll-theme-chirpy.css'));
    assert.ok(html.includes('https://entreluma.org/assets/js/dist/theme.min.js'));
    assert.ok(html.includes('https://editor.example/assets/css/custom.css'));
    assert.ok(html.includes('https://editor.example/assets/posts/local/pic.png'));
  });

  it('rewrites components/entreluma js/css to the canonical; leaves media alone', async () => {
    await loadClassicLibs();
    if (typeof window.markdownit !== 'function') {
      throw new Error(`pre-import state: liquidjs=${typeof window.liquidjs} markdownit=${typeof window.markdownit} jsyaml=${typeof window.jsyaml}`);
    }
    const { renderPost } = await import('/assets/js/skrender.js');
    const context = {
      config: { url: 'https://user.github.io', baseurl: '/their-site', title: 'T' },
      assetOrigin: 'https://user.github.io',
      baseurl: '/their-site',
      frameworkAssetOrigin: 'https://entreluma.org',
      resolveFile: async (p) => {
        if (p === '_layouts/nolayout.html') return '{{ content }}';
        return null;
      },
      layouts: new Map(), includes: new Map(), locales: null,
    };
    const content = [
      '---', 'title: FW test', 'layout: nolayout', '---', '',
      '<iframe src="https://user.github.io/their-site/assets/components/image.html?src=x"></iframe>',
      '<script src="https://user.github.io/their-site/assets/js/entreluma.js"></script>',
      '<link href="https://user.github.io/their-site/assets/css/entreluma.css">',
      '<img src="https://user.github.io/their-site/assets/posts/pic.jpg">',
    ].join('\n');
    const { html } = await renderPost({ content, path: '_posts/2026-07-08-fw.md', context });
    assert.ok(html.includes('https://entreluma.org/assets/components/image.html'),
      'component iframe rewritten to canonical');
    assert.ok(html.includes('https://entreluma.org/assets/js/entreluma.js'),
      'host runtime rewritten');
    assert.ok(html.includes('https://entreluma.org/assets/css/entreluma.css'),
      'entreluma.css rewritten');
    assert.ok(html.includes('https://user.github.io/their-site/assets/posts/pic.jpg'),
      'site media NOT rewritten');
    assert.ok(!html.includes('their-site/assets/components/'), 'no bound-site component refs remain');
  });

  it('no-ops when frameworkAssetOrigin equals the bound base or is unset', async () => {
    await loadClassicLibs();
    if (typeof window.markdownit !== 'function') {
      throw new Error(`pre-import state: liquidjs=${typeof window.liquidjs} markdownit=${typeof window.markdownit} jsyaml=${typeof window.jsyaml}`);
    }
    const { renderPost } = await import('/assets/js/skrender.js');
    const mk = (fw) => ({
      config: { url: 'https://rsnyder.github.io', baseurl: '/entreluma', title: 'T' },
      assetOrigin: 'https://rsnyder.github.io', baseurl: '/entreluma',
      ...(fw ? { frameworkAssetOrigin: fw } : {}),
      resolveFile: async (p) => (p === '_layouts/nolayout.html' ? '{{ content }}' : null),
      layouts: new Map(), includes: new Map(), locales: null,
    });
    const content = '---\ntitle: N\nlayout: nolayout\n---\n\n<iframe src="https://entreluma.org/assets/components/map.html"></iframe>\n';
    const a = await renderPost({ content, path: '_posts/2026-07-08-n.md', context: mk('https://entreluma.org') });
    const b = await renderPost({ content, path: '_posts/2026-07-08-n.md', context: mk(null) });
    assert.equal(a.html, b.html, 'same-base rewrite is byte-identical to unset');
  });
});

describe('skrender: wc: URLs with non-ASCII filenames (UTF-8 md5)', () => {
  it('hashes UTF-8 bytes like MediaWiki/Ruby (März → /a/a7/), not UTF-16 units', async () => {
    await loadClassicLibs();
    const { renderPost } = await import('/assets/js/skrender.js');
    const context = {
      config: { url: 'https://user.github.io', baseurl: '/site', title: 'T' },
      assetOrigin: 'https://user.github.io', baseurl: '/site',
      resolveFile: async (p) => (p === '_layouts/nolayout.html' ? '{{ content }}' : null),
      layouts: new Map(), includes: new Map(), locales: null,
    };
    const content = '---\ntitle: U\nlayout: nolayout\n---\n\n' +
      '![Geigersberg](wc:Sachsenheim_-_Ochsenbach_-_Geigersberg_-_nördlicher_Teil_von_SSO_im_März.jpg)\n';
    const { html } = await renderPost({ content, path: '_posts/2026-07-08-u.md', context });
    assert.ok(html.includes('/thumb/a/a7/'),
      `expected the UTF-8 md5 path segment /a/a7/ in: ${html.slice(html.indexOf('thumb'), html.indexOf('thumb') + 60)}`);
    assert.ok(!html.includes('/thumb/5/52/'), 'the mangled UTF-16 hash must be gone');
  });
});

describe('skrender: absolute media_subpath (external asset host)', () => {
  it('header and body images resolve to the external host, untouched by rawBase', async () => {
    await loadClassicLibs();
    const { renderPost } = await import('/assets/js/skrender.js');
    const context = {
      config: { url: 'https://user.github.io', baseurl: '/site', title: 'T' },
      assetOrigin: 'https://user.github.io', baseurl: '/site',
      rawContentBase: 'https://raw.githubusercontent.com/o/r/main/',
      resolveFile: async (p) => (p === '_layouts/nolayout.html' ? '{{ content }}' : null),
      layouts: new Map(), includes: new Map(), locales: null,
    };
    const content = [
      '---', 'title: Turmeric', 'layout: nolayout',
      'media_subpath: https://lab.plant-humanities.org/assets/posts/turmeric', '---', '',
      '![banner](banner.jpg)',
    ].join('\n');
    const { html } = await renderPost({ content, path: '_posts/2026-07-08-turmeric.md', context });
    assert.ok(html.includes('https://lab.plant-humanities.org/assets/posts/turmeric/banner.jpg'),
      'media_subpath + relative image → external absolute URL');
    assert.ok(!html.includes('raw.githubusercontent.com/o/r/main/_posts/https'),
      'no rawBase glued onto an absolute URL');
  });
});

describe('skrender: kramdown-compatible heading auto-ids', () => {
  async function renderBody(body) {
    await loadClassicLibs();
    const { renderPost } = await import('/assets/js/skrender.js');
    const context = {
      config: { url: 'https://u.io', baseurl: '/s', title: 'T' },
      assetOrigin: 'https://u.io', baseurl: '/s',
      resolveFile: async (p) => (p === '_layouts/nolayout.html' ? '{{ content }}' : null),
      layouts: new Map(), includes: new Map(), locales: null,
    };
    const { html } = await renderPost({
      content: '---\ntitle: H\nlayout: nolayout\n---\n\n' + body,
      path: '_posts/2026-07-09-h.md', context });
    return html;
  }

  it('matches kramdown basic_generate_id (ground-truthed against the Jekyll build)', async () => {
    const html = await renderBody([
      '## What is Entreluma?',
      '## First-class support for Wikimedia Commons',
      '## The `image` include',
      '## 123 Numbers first',
      '## Examples', '## Examples',   // duplicate → -1 suffix
      '## ???',                        // nothing survives → section
    ].join('\n\n'));
    for (const id of [
      'id="what-is-entreluma"',
      'id="first-class-support-for-wikimedia-commons"',
      'id="the-image-include"',
      'id="numbers-first"',
      'id="examples"', 'id="examples-1"',
      'id="section"',
    ]) {
      assert.ok(html.includes(id), `missing ${id}`);
    }
  });
});


describe('skrender: repository images when deployment supplies the site URL', () => {
  it('resolves the hero and Markdown images at the pinned repository revision without changing external or managed images', async () => {
    await loadClassicLibs();
    const {renderPost} = await import('/assets/js/skrender.js');
    const base = 'https://raw.githubusercontent.com/rsnyder/entreluma-site/' + 'a'.repeat(40) + '/';
    const context = {
      config:{},assetOrigin:'https://editor.example',baseurl:'',rawContentBase:base,mediaAssetBase:base,
      resolveFile:async path => path === '_layouts/post.html' ? '<html><head></head><body><img class="preview-img" src="{{ page.image.path }}">{{ content }}</body></html>' : null,
    };
    const content = '---\nlayout: post\nimage:\n  path: Monument_Valley.jpg\nmedia_subpath: /assets/posts/monument-valley\n---\n' +
      '![Related](detail.jpg)\n\n![External](https://images.example/photo.jpg)\n\n<img src="sk-local:managed">';
    const {html} = await renderPost({content,path:'_posts/2026-01-10-monument-valley.md',context});
    assert.ok(html.includes('src="' + base + 'assets/posts/monument-valley/Monument_Valley.jpg"'));
    assert.ok(html.includes('src="' + base + 'assets/posts/monument-valley/detail.jpg"'));
    assert.ok(html.includes('src="https://images.example/photo.jpg"'));
    assert.ok(html.includes('src="sk-local:managed"'));
    assert.ok(!html.includes('https://editor.example/assets/posts/'));
  });

  it('removes the deployment base path from repository-root image paths', async () => {
    await loadClassicLibs();
    const {renderPost} = await import('/assets/js/skrender.js');
    const base = 'https://raw.githubusercontent.com/example/site/' + 'b'.repeat(40) + '/';
    const {html} = await renderPost({content:'---\nlayout: post\n---\n<img src="/site/assets/photo.jpg?size=2">',path:'_posts/test.md',context:{
      config:{},assetOrigin:'https://editor.example',baseurl:'/site',rawContentBase:base,mediaAssetBase:base,
      resolveFile:async p=>p==='_layouts/post.html'?'<html><head></head><body>{{ content }}</body></html>':null,
    }});
    assert.ok(html.includes('src="' + base + 'assets/photo.jpg?size=2"'));
  });
});


describe('skrender: unpublished branch media', () => {
  it('builds media-url image URLs from the pinned revision, not the deployed site, when a site url is configured', async () => {
    await loadClassicLibs();
    const {renderPost} = await import('/assets/js/skrender.js');
    const base = 'https://raw.githubusercontent.com/rsnyder/plant-humanities-lab/' + 'c'.repeat(40) + '/';
    const mediaUrl = '{%- assign url = include.src -%}{%- assign url = include.subpath | append: \'/\' | append: url -%}' +
      '{%- assign url = site.url | append: site.baseurl | append: url -%}{{- url -}}';
    const {html} = await renderPost({path:'_posts/2026-08-15-madder.md', content:'---\nlayout: post\nmedia_subpath: /assets/posts/madder\n---\n' +
      '{% include media-url.html src="zoom.jpg" subpath=page.media_subpath %}',
      context:{config:{url:'https://lab.plant-humanities.org'},assetOrigin:'https://lab.plant-humanities.org',baseurl:'',
        rawContentBase:base,mediaAssetBase:base,
        resolveFile:async p => p==='_layouts/post.html' ? '<html><head></head><body>{{ content }}</body></html>'
          : p==='_includes/media-url.html' ? mediaUrl : null}});
    assert.ok(html.includes(base + 'assets/posts/madder/zoom.jpg'));
    assert.ok(!html.includes('lab.plant-humanities.org/assets/posts/madder'));
  });
});


describe('skrender: undeclared publication URL viewer fallback', () => {
  it('loads YouTube viewers and their host from the standard runtime while keeping repository images pinned', async () => {
    await loadClassicLibs();
    const {renderPost} = await import('/assets/js/skrender.js');
    const base='https://raw.githubusercontent.com/example/site/'+'a'.repeat(40)+'/';
    const {html} = await renderPost({path:'_posts/test.md', content:'---\nlayout: post\n---\n'+
      '<iframe class="embed-youtube" src="/assets/components/youtube.html?vid=yg0As_HOvJk&autoplay=true"></iframe>\n'+
      '<iframe class="embed-youtube" src="/assets/components/youtube.html?vid=GGyiZ7SE3V4"></iframe>\n'+
      '<script type="module">import {initEntreluma} from "/assets/js/entreluma.js";</script>\n'+
      '<img src="/assets/posts/example/photo.jpg">',context:{
        config:{},assetOrigin:'https://editor.entreluma.org',baseurl:'',rawContentBase:base,mediaAssetBase:base,
        frameworkAssetOrigin:'https://entreluma.org',
        resolveFile:async p=>p==='_layouts/post.html'?'<html><head></head><body>{{ content }}</body></html>':null,
      }});
    assert.ok(html.includes('https://entreluma.org/assets/components/youtube.html?vid=yg0As_HOvJk&autoplay=true'));
    assert.ok(html.includes('https://entreluma.org/assets/components/youtube.html?vid=GGyiZ7SE3V4'));
    assert.ok(html.includes('https://entreluma.org/assets/js/entreluma.js'));
    assert.ok(html.includes(base+'assets/posts/example/photo.jpg'));
    assert.ok(!html.includes('https://editor.entreluma.org/assets/components/'));
  });
});
