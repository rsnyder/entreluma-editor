import {describe, it, assert} from './runner.js';
import {publicationRuntime, supportsLocalViewer} from '../../editor/preview-runtime.js';

describe('publication runtime declarations', () => {
  it('preserves declared viewers only at the publication runtime paths', async () => {
    const original = globalThis.fetch;
    let count = 0;
    globalThis.fetch = async (url, options) => {
      count++;
      assert.equal(String(url), 'https://compatible.example/site/assets/entreluma-preview.json');
      assert.equal(options.credentials, 'omit');
      return new Response(JSON.stringify({schemaVersion:1,host:1,localImage:1,localMap:1}));
    };
    try {
      const ctx = {publication:true,config:{url:'https://compatible.example'},assetOrigin:'https://compatible.example',baseurl:'/site'};
      const runtime = await publicationRuntime(ctx);
      assert.ok(supportsLocalViewer(runtime, new URL('https://compatible.example/site/assets/components/image.html?x=1'), 'image'));
      assert.ok(supportsLocalViewer(runtime, new URL('https://compatible.example/site/assets/components/map'), 'map'));
      assert.equal(supportsLocalViewer(runtime,new URL('https://other.example/site/assets/components/image.html'),'image'),false);
      assert.equal(supportsLocalViewer(runtime,new URL('https://compatible.example/custom/image.html'),'image'),false);
      await publicationRuntime(ctx);
      assert.equal(count,1);
      await publicationRuntime(ctx,{refresh:true});
      assert.equal(count,2);
    } finally {globalThis.fetch = original;}
  });
  it('caches missing declarations and rejects unsupported protocol versions', async () => {
    const original = globalThis.fetch;
    let count=0;
    globalThis.fetch=async()=>{count++;return new Response('{}',{status:404});};
    try {
      const ctx={publication:true,config:{url:'https://old.example'},assetOrigin:'https://old.example'};
      assert.equal(await publicationRuntime(ctx),null);
      assert.equal(await publicationRuntime(ctx),null);
      assert.equal(count,1);
      globalThis.fetch=async()=>new Response(JSON.stringify({schemaVersion:2,host:1,localImage:1}));
      assert.equal(await publicationRuntime(ctx,{refresh:true}),null);
    } finally {globalThis.fetch=original;}
  });
});
