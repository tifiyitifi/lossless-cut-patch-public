// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { deriveNameFromSrcTxtFileName, projectToSrcTxt, srcTxtToProject } from './srcTxtConvert.js';
import { countSegments, normalizePatchProject, parsePatchProject, serializePatchProject } from './project.js';
import type { PatchProject } from './project.js';

const legacySample = `<

"dir1"
:video1.mp4
010203 010210
010300 010305

:video2.mp4
010400 010405

>
`;

describe('srcTxtToProject', () => {
  it('parses a merge group with directory marker and multiple files', () => {
    const project = srcTxtToProject(legacySample, { sourceTxt: 'src_demo.txt' });
    expect(project.groups).toHaveLength(1);
    const [group] = project.groups;
    expect(group?.merge).toBe(true);
    expect(group?.dirName).toBe('dir1');
    expect(group?.segments).toStrictEqual([
      { file: 'video1.mp4', start: 3723, end: 3730 },
      { file: 'video1.mp4', start: 3780, end: 3785 },
      { file: 'video2.mp4', start: 3840, end: 3845 },
    ]);
    expect(countSegments(project)).toBe(3);
    expect(project.sourceTxt).toBe('src_demo.txt');
  });

  it('parses segments outside merge groups', () => {
    const project = srcTxtToProject(':a.mp4\n000100 000200\n');
    expect(project.groups).toHaveLength(1);
    expect(project.groups[0]?.merge).toBe(false);
    expect(project.groups[0]?.segments).toStrictEqual([{ file: 'a.mp4', start: 60, end: 120 }]);
  });

  it('ignores comment and blank lines', () => {
    const project = srcTxtToProject('/comment\n|other\n\n:a.mp4\n000100 000200\n');
    expect(countSegments(project)).toBe(1);
  });
});

describe('projectToSrcTxt', () => {
  it('round trips through parse -> serialize -> parse', () => {
    const project = srcTxtToProject(legacySample);
    const text = projectToSrcTxt(project);
    const reparsed = srcTxtToProject(text);
    expect(reparsed.groups).toStrictEqual(project.groups);
  });

  it('emits merge markers only for merge groups', () => {
    const project: PatchProject = {
      version: 1,
      groups: [{ merge: false, segments: [{ file: 'x.mp4', start: 1, end: 2 }] }],
    };
    const text = projectToSrcTxt(project);
    expect(text).not.toContain('<');
    expect(text).toContain(':x.mp4');
    expect(text).toContain('00:00:01.000 00:00:02.000');
  });
});

describe('deriveNameFromSrcTxtFileName', () => {
  it('extracts the name', () => {
    expect(deriveNameFromSrcTxtFileName('src_myvideos.txt')).toBe('myvideos');
    expect(deriveNameFromSrcTxtFileName('other.txt')).toBeUndefined();
  });
});

describe('project json (de)serialization', () => {
  it('round trips', () => {
    const project = srcTxtToProject(legacySample);
    const json = serializePatchProject(project);
    expect(parsePatchProject(json)).toStrictEqual(project);
  });

  it('normalizes invalid input', () => {
    const normalized = normalizePatchProject({ groups: [{ segments: [{ file: 'a.mp4', start: 1, end: 2 }, { file: '', start: 0, end: 1 }] }] });
    expect(countSegments(normalized)).toBe(1);
    expect(normalized.groups[0]?.merge).toBe(false);
  });

  it('throws on non object input', () => {
    expect(() => normalizePatchProject(42)).toThrow();
  });
});
