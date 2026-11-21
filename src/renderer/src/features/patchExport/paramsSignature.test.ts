// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { FileParams, ParamsByFile } from '../../types';
import serializeParamsByFile from './paramsSignature';

function fileParams(overrides: Partial<FileParams> = {}): FileParams {
  return {
    paramsByStream: new Map([[0, { metadata: {} }]]),
    metadata: {},
    ...overrides,
  };
}

function params(entries: [string, FileParams][]): ParamsByFile {
  return new Map(entries);
}

describe('serializeParamsByFile', () => {
  it('includes stream-level settings, which a plain JSON.stringify would drop', () => {
    const before = serializeParamsByFile(params([['/source.mp4', fileParams()]]));
    const after = serializeParamsByFile(params([['/source.mp4', fileParams({ paramsByStream: new Map([[0, { metadata: {}, disposition: 'default' }]]) })]]));
    expect(after).not.toStrictEqual(before);
  });

  it('changes when a bitstream filter is toggled', () => {
    const withoutFilter = params([['/source.mp4', fileParams()]]);
    const withFilter = params([['/source.mp4', fileParams({ paramsByStream: new Map([[0, { metadata: {}, bsfHevcAudInsert: true }]]) })]]);
    expect(serializeParamsByFile(withFilter)).not.toStrictEqual(serializeParamsByFile(withoutFilter));
  });

  it('does not depend on the Map insertion order', () => {
    const first = params([
      ['/b.mp4', fileParams({ paramsByStream: new Map([[2, { metadata: {}, tag: 'x' }], [1, { metadata: {}, tag: 'y' }]]) })],
      ['/a.mp4', fileParams()],
    ]);
    const second = params([
      ['/a.mp4', fileParams()],
      ['/b.mp4', fileParams({ paramsByStream: new Map([[1, { metadata: {}, tag: 'y' }], [2, { metadata: {}, tag: 'x' }]]) })],
    ]);
    expect(serializeParamsByFile(first)).toStrictEqual(serializeParamsByFile(second));
  });

  it('includes the file metadata and offset', () => {
    const before = serializeParamsByFile(params([['/source.mp4', fileParams()]]));
    const after = serializeParamsByFile(params([['/source.mp4', fileParams({ metadata: { title: 'x' }, offset: 1.5 })]]));
    expect(after).not.toStrictEqual(before);
  });
});
