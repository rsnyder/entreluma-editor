/** YouTube playback lives outside the opaque publication frame. Only validated
 * video IDs and numeric playback bounds can cross this boundary, never URLs. */
export function youtubeVideo(source) {
  try {
    const url = new URL(source);
    const vid = url.searchParams.get('vid');
    if (url.protocol !== 'https:' || !url.pathname.endsWith('/assets/components/youtube.html') || !/^[\w-]{11}$/.test(vid || '')) return null;
    const result = {vid, autoplay: url.searchParams.get('autoplay') === 'true'};
    for (const name of ['start', 'end']) {
      const n = Number(url.searchParams.get(name));
      if (Number.isFinite(n) && n > 0 && n <= 86400) result[name] = Math.floor(n);
    }
    return result;
  } catch { return null; }
}

export function youtubeDialogScript(generation) {
  return `<script>(${function (generation) {
    addEventListener('message', event => {
      if (event.data?.type !== 'entreluma:showDialog') return;
      const sender = [...document.querySelectorAll('iframe.embed-youtube')].find(f => f.contentWindow === event.source);
      if (!sender) return;
      try {
        const original = new URL(sender.src);
        const target = new URL(event.data.payload?.src, original);
        if (target.origin !== original.origin || target.pathname !== original.pathname || target.searchParams.get('vid') !== original.searchParams.get('vid')) return;
        event.stopImmediatePropagation();
        parent.postMessage({kind:'entreluma-youtube-open', generation, vid:original.searchParams.get('vid'), start:target.searchParams.get('start'), end:target.searchParams.get('end')}, '*');
      } catch {}
    }, true);
  }.toString()})(${JSON.stringify(generation)});</script>`;
}

export function attachYouTubeDialog(frame, generation, videos, host = window) {
  let dialog = null;
  let active = true;
  let previousInert = false;
  const close = () => {
    if (!dialog) return;
    const restoreFocus = dialog.contains(frame.ownerDocument.activeElement);
    dialog.remove(); dialog = null;
    frame.inert = previousInert;
    if (restoreFocus && frame.isConnected) frame.focus();
  };
  function receive(event) {
    const data = event.data;
    if (!active || event.source !== frame.contentWindow || data?.kind !== 'entreluma-youtube-open' || data.generation !== generation) return;
    const video = videos.find(v => v.vid === data.vid);
    if (!video || !/^[\w-]{11}$/.test(video.vid)) return;
    close();
    const doc = frame.ownerDocument;
    dialog = doc.createElement('dialog');
    dialog.setAttribute('aria-label', 'YouTube video');
    // Stay in the preview's positioned wrapper, outside the opaque iframe but
    // also outside the browser top layer, which would cover/inert the editor.
    dialog.style.cssText = 'position:absolute;inset:0;margin:0;width:100%;height:100%;max-width:none;max-height:none;box-sizing:border-box;padding:16px;border:0;background:rgb(0 0 0 / 60%);color:white;display:flex;align-items:center;justify-content:center;z-index:2;';
    const panel = doc.createElement('div');
    panel.style.cssText = 'width:100%;max-width:960px;max-height:100%;overflow:auto;box-sizing:border-box;padding:12px;border-radius:8px;background:#171717;';
    const player = doc.createElement('iframe');
    player.title = 'YouTube video player';
    player.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;border:0;';
    // This is always YouTube, never publication-controlled HTML or a URL from a message.
    const url = new URL('https://www.youtube-nocookie.com/embed/' + video.vid);
    url.searchParams.set('autoplay', video.autoplay ? '1' : '0');
    for (const key of ['start', 'end']) {
      const n = Number(data[key] ?? video[key]);
      if (Number.isFinite(n) && n > 0 && n <= 86400) url.searchParams.set(key, String(Math.floor(n)));
    }
    player.src = url.href;
    player.referrerPolicy = 'strict-origin';
    player.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    player.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    player.setAttribute('allowfullscreen', '');
    const button = doc.createElement('button');
    button.textContent = 'Close video';
    button.style.cssText = 'margin-top:12px;padding:8px 16px;';
    button.addEventListener('click', close);
    dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault(); close();}
    });
    panel.append(player, button);
    dialog.append(panel);
    frame.parentElement.append(dialog);
    previousInert = frame.inert;
    frame.inert = true;
    dialog.show();
    button.focus();
  }
  host.addEventListener('message', receive);
  return () => {active = false; close(); host.removeEventListener('message', receive);};
}
