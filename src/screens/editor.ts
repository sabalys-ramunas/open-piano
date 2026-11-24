import '../styles/editor.css';
import type { AppContext } from '../app/context';
import { appBar, h, notice } from '../app/dom';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import { pageTitle } from '../app/title';
import { mountEditor } from '../editor';

/**
 * #/editor and #/editor/<songId>. The editor itself lives in src/editor/.
 * Built-in songs are fetched on demand, so a song may need a moment to load.
 */
export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  const songId = route.screen === 'editor' ? route.songId : undefined;
  const summary = songId ? ctx.library.summary(songId) : undefined;
  container.append(
    appBar(
      songId ? 'Edit notes' : 'Write or fix a song',
      songId && summary
        ? { back: { route: { screen: 'play', songId }, label: `Back to ${summary.title}` } }
        : { back: { route: { screen: 'home' }, label: 'Songs' } },
    ),
  );
  const body = h('div', { class: 'editor-root' });
  container.append(body);
  if (summary) pageTitle(`Edit notes: ${summary.title}`);

  let alive = true;
  let inner: Cleanup | null = null;
  if (!songId || ctx.library.get(songId) || !ctx.library.has(songId)) {
    // Unknown ids still go to the editor: it waits a moment for the song list, then says it is missing.
    inner = mountEditor(body, ctx, songId);
  } else {
    const loading = notice('loading', 'Opening the song...');
    body.append(loading);
    void ctx.library.ensure(songId).then(() => {
      if (!alive) return;
      loading.remove();
      inner = mountEditor(body, ctx, songId);
    });
  }
  return () => {
    alive = false;
    inner?.();
  };
}
