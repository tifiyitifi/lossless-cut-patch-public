import { useEffect, useReducer, useRef } from 'react';

import { renderThumbnail } from '../../ffmpeg';

/**
One frame per row of the check panel, rendered only when the row is on screen (fork-owned).

A work area can hold hundreds of sources and results, and every thumbnail is one FFmpeg process, so
the rows that are scrolled out of view must not cost anything. A shared `IntersectionObserver` notes
a row as it comes into view and queues its frame; two FFmpeg processes run at a time.

The frames are kept in memory for the lifetime of the window, keyed by path, size and modification
time (`cacheKey`): a rescan after a delete or a finish job re-renders the same pictures without
spawning FFmpeg again, while a file that changed on disk gets a new picture. A file whose frame
cannot be rendered is remembered as empty, so a broken file is not retried on every scroll.
*/

interface ThumbnailTask {
  element: Element;
  cacheKey: string;
  path: string;
  time: number;
  notify: () => void;
}

const frames = new Map<string, string>();
const tasksByElement = new Map<Element, ThumbnailTask>();
const queue: ThumbnailTask[] = [];
let running = 0;
let observer: IntersectionObserver | undefined;

function pump() {
  while (running < 2 && queue.length > 0) {
    const task = queue.shift();
    if (task == null) return;
    // eslint-disable-next-line no-use-before-define -- the two functions drain one queue together
    startTask(task);
  }
}

function startTask(task: ThumbnailTask) {
  if (frames.has(task.cacheKey)) {
    task.notify();
    return;
  }
  running += 1;
  const controller = new AbortController();
  renderThumbnail(task.path, task.time, controller.signal)
    .then((url) => { frames.set(task.cacheKey, url); })
    .catch(() => { frames.set(task.cacheKey, ''); })
    .finally(() => {
      running -= 1;
      task.notify();
      pump();
    });
}

function ensureObserver() {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const task = tasksByElement.get(entry.target);
      if (task == null) continue;
      observer?.unobserve(entry.target);
      tasksByElement.delete(entry.target);
      if (frames.has(task.cacheKey)) {
        task.notify();
        continue;
      }
      queue.push(task);
      pump();
    }
  }, { rootMargin: '300px' });
  return observer;
}

export default function LazyFrame({ path, cacheKey, time, width = 96, height = 54, fill = false }: {
  path: string;
  /** Changes when the file changed on disk; a new key means a new picture. */
  cacheKey: string;
  /** The position the frame is taken from, in seconds. */
  time: number;
  width?: number | undefined;
  height?: number | undefined;
  /** Fill the card's width and keep a 16:9 shape (the grid tiles); `width`/`height` are ignored. */
  fill?: boolean | undefined;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [, rerender] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    const element = ref.current;
    if (element == null || frames.has(cacheKey)) return undefined;
    const task: ThumbnailTask = {
      element,
      cacheKey,
      path,
      time,
      notify: () => { rerender(); },
    };
    tasksByElement.set(element, task);
    ensureObserver().observe(element);
    return () => {
      observer?.unobserve(element);
      tasksByElement.delete(element);
      const index = queue.indexOf(task);
      if (index !== -1) queue.splice(index, 1);
    };
  }, [cacheKey, path, time]);

  const url = frames.get(cacheKey);

  return (
    <div
      ref={ref}
      style={{
        ...(fill ? { width: '100%', aspectRatio: '16 / 9' } : { width, height }),
        flexShrink: 0,
        background: 'var(--gray-4)',
        borderRadius: '.2em',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url != null && url !== '' && (
        <img
          src={url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}
