import { APP_NAME } from './brand';

/** Sets the browser tab title: "Lesson name · Piano", or just the app name. */
export function pageTitle(text?: string | null): void {
  const clean = text?.replace(/\s+/g, ' ').trim();
  document.title = clean ? `${clean} · ${APP_NAME}` : APP_NAME;
}
