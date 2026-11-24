import '../styles/course.css';
import type { AppContext } from '../app/context';
import { appBar, link, notice } from '../app/dom';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import { findLesson } from '../course/curriculum';
import { mountLesson } from '../course/lesson-view';
import { mountMap } from '../course/map';

/** #/course shows the course map; #/course/<lessonId> runs one lesson. */
export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  const lessonId = route.screen === 'course' ? route.lessonId : undefined;
  if (!lessonId) return mountMap(container, ctx);
  const lesson = findLesson(lessonId);
  if (lesson) return mountLesson(container, ctx, lesson);
  container.append(
    appBar('Lesson not found', { back: { route: { screen: 'course' }, label: 'Course map' } }),
    notice('empty', 'We could not find that lesson', 'It may have moved or been renamed.', link({ screen: 'course' }, 'Go to the course map', { class: 'button primary' })),
  );
  return () => {};
}
