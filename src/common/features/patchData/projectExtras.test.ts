// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import JSON5 from 'json5';

import { buildProjectData, readProjectExtras } from './projectExtras.js';
import { renderLlcProjectText } from './llcProjectText.js';

describe('readProjectExtras', () => {
  it('keeps the top-level fields that do not belong to the project itself', () => {
    const text = JSON5.stringify({
      version: 3,
      mediaFileName: 'a.mp4',
      patchExport: { merged: [], clips: [] },
      somethingNewer: 42,
      cutSegments: [{ start: 0, end: 1, name: '' }],
    });
    expect(readProjectExtras(text)).toStrictEqual({ patchExport: { merged: [], clips: [] }, somethingNewer: 42 });
  });

  it('reads a commented file (the comments are invisible to JSON5)', () => {
    const text = "// header\n{\n  version: 3,\n  mediaFileName: 'a.mp4',\n  patchExport: { clips: [] },\n  cutSegments: [],\n}";
    expect(readProjectExtras(text)).toStrictEqual({ patchExport: { clips: [] } });
  });

  it('returns nothing for a file it cannot parse', () => {
    expect(readProjectExtras('{ this is not json5')).toStrictEqual({});
  });

  it('returns nothing for a value that is not an object', () => {
    expect(readProjectExtras('[1, 2]')).toStrictEqual({});
    expect(readProjectExtras('null')).toStrictEqual({});
  });
});

describe('buildProjectData', () => {
  it('orders the known fields around the carried ones, with cutSegments last', () => {
    const project = buildProjectData({
      version: 3,
      mediaFileName: 'a.mp4',
      cutSegments: [],
      extras: { patchExport: { clips: [] } },
    });
    expect(Object.keys(project)).toStrictEqual(['version', 'mediaFileName', 'patchExport', 'cutSegments']);
    expect(project).toStrictEqual({ version: 3, mediaFileName: 'a.mp4', patchExport: { clips: [] }, cutSegments: [] });
  });

  it('never lets a carried field override the regenerated ones', () => {
    const project = buildProjectData({
      version: 2,
      mediaFileName: 'a.mp4',
      cutSegments: [],
      extras: { version: 1, mediaFileName: 'stale.mp4', cutSegments: [{ start: 0 }] },
    });
    expect(project).toStrictEqual({ version: 2, mediaFileName: 'a.mp4', cutSegments: [] });
  });

  it('keeps the carried fields in their own order', () => {
    const project = buildProjectData({ version: 3, mediaFileName: 'a.mp4', cutSegments: [], extras: { b: 1, a: 2 } });
    expect(Object.keys(project)).toStrictEqual(['version', 'mediaFileName', 'b', 'a', 'cutSegments']);
  });

  it('drops a carried field that could not be written anyway', () => {
    const project = buildProjectData({ version: 3, mediaFileName: 'a.mp4', cutSegments: [], extras: { gone: undefined } });
    expect(project).toStrictEqual({ version: 3, mediaFileName: 'a.mp4', cutSegments: [] });
  });

  it('leaves out a known field that is unknown (no version)', () => {
    expect(Object.keys(buildProjectData({ version: undefined, mediaFileName: undefined, cutSegments: [] }))).toStrictEqual(['cutSegments']);
  });

  it('survives the render/parse round trip with the carried fields', () => {
    const extras = readProjectExtras("{ version: 3, mediaFileName: 'old.mp4', patchExport: { merged: [{ path: 'm.mp4', segIds: [] }] }, cutSegments: [] }");
    const project = buildProjectData({ version: 3, mediaFileName: 'a.mp4', cutSegments: [], extras });
    expect(JSON5.parse(renderLlcProjectText(project))).toStrictEqual({
      version: 3,
      mediaFileName: 'a.mp4',
      patchExport: { merged: [{ path: 'm.mp4', segIds: [] }] },
      cutSegments: [],
    });
  });
});
