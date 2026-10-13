import {describe, it, assert} from './runner.js';
import {youtubeVideo, attachYouTubeDialog, youtubeDialogScript} from '../../editor/youtube-dialog.js';

describe('isolated YouTube playback', () => {
  it('accepts only HTTPS component URLs with valid video IDs', () => {
    assert.equal(youtubeVideo('https://entreluma.org/assets/components/youtube.html?vid=yg0As_HOvJk&start=10.5').start, 10);
    for (const url of ['javascript:alert(1)', 'http://example.com/assets/components/youtube.html?vid=yg0As_HOvJk', 'https://example.com/other?vid=yg0As_HOvJk', 'https://example.com/assets/components/youtube.html?vid=../evil']) assert.equal(youtubeVideo(url), null);
  });
  it('rejects unrelated senders, stale generations, and unregistered video IDs', () => {
    const host = new EventTarget();
    const frame = document.createElement('iframe'); document.body.append(frame);
    const release = attachYouTubeDialog(frame, 'current', [{vid:'yg0As_HOvJk'}], host);
    try {
      for (const [source, generation, vid] of [[window,'current','yg0As_HOvJk'],[frame.contentWindow,'old','yg0As_HOvJk'],[frame.contentWindow,'current','GGyiZ7SE3V4']]) {
        host.dispatchEvent(new MessageEvent('message',{source,data:{kind:'entreluma-youtube-open',generation,vid}}));
        assert.equal(document.querySelector('dialog[aria-label="YouTube video"]'), null);
      }
    } finally {release();frame.remove();}
  });
  it('constructs only a YouTube embed, preserves isolation, and removes playback on teardown', () => {
    const host = new EventTarget();
    const frame = document.createElement('iframe'); frame.sandbox='allow-scripts';document.body.append(frame);
    const release = attachYouTubeDialog(frame, 'current', [{vid:'yg0As_HOvJk',autoplay:true}], host);
    const send = () => host.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{kind:'entreluma-youtube-open',generation:'current',vid:'yg0As_HOvJk',src:'https://evil.example',start:'20',end:'Infinity'}}));
    try {
      send();
      const player = document.querySelector('dialog[aria-label="YouTube video"] iframe');
      assert.equal(player.src,'https://www.youtube-nocookie.com/embed/yg0As_HOvJk?autoplay=1&start=20');
      assert.equal(player.referrerPolicy,'strict-origin');
      assert.equal(frame.getAttribute('sandbox'),'allow-scripts');
      release();send();
      assert.equal(document.querySelector('dialog[aria-label="YouTube video"]'),null);
    } finally {release();frame.remove();}
  });
  it('contains the dialog in the preview while leaving the editor interactive', () => {
    const host = new EventTarget();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:400px;height:300px;margin-left:100px;';
    const frame = document.createElement('iframe');
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;';
    const editor = document.createElement('button'); editor.textContent = 'Editor control';
    wrap.append(frame);document.body.append(editor, wrap);
    const release = attachYouTubeDialog(frame, 'current', [{vid:'yg0As_HOvJk'}], host);
    try {
      host.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{kind:'entreluma-youtube-open',generation:'current',vid:'yg0As_HOvJk'}}));
      const dialog = wrap.querySelector('dialog');
      assert.ok(dialog.open);
      assert.ok(!dialog.matches(':modal'));
      assert.ok(frame.inert);
      for (const width of [400, 240]) {
        wrap.style.width = width + 'px';
        const bounds = wrap.getBoundingClientRect(), actual = dialog.getBoundingClientRect();
        assert.ok(actual.left >= bounds.left && actual.right <= bounds.right);
        assert.ok(actual.top >= bounds.top && actual.bottom <= bounds.bottom);
      }
      editor.focus();assert.equal(document.activeElement, editor);
      dialog.querySelector('button').click();
      assert.ok(!frame.inert);
      assert.equal(wrap.querySelector('dialog'), null);
    } finally {release();wrap.remove();editor.remove();}
  });
  it('intercepts only registered YouTube viewer dialog messages', () => {
    const script = youtubeDialogScript('test-generation');
    assert.ok(script.includes("iframe.embed-youtube"));
    assert.ok(script.includes('target.origin !== original.origin'));
  });
});
