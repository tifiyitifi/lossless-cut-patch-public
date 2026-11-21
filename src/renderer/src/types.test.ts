// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { llcProjectV1Schema, llcProjectV2Schema, llcProjectV3Schema } from './types';

describe('.llc segment schemas', () => {
  it('keep the fields of a segment this build does not know', () => {
    const v3 = llcProjectV3Schema.parse({
      version: 3,
      cutSegments: [{ start: '00:00:01.000000000', end: '00:00:02.000000000', name: 'a', futureField: 1 }],
    });
    expect(v3.cutSegments[0]).toMatchObject({ futureField: 1 });

    const v2 = llcProjectV2Schema.parse({
      version: 2,
      cutSegments: [{ start: 1, end: 2, name: 'a', futureField: 1 }],
    });
    expect(v2.cutSegments[0]).toMatchObject({ futureField: 1 });

    const v1 = llcProjectV1Schema.parse({
      version: 1,
      cutSegments: [{ start: 1, name: 'a', futureField: 1 }],
    });
    expect(v1.cutSegments[0]).toMatchObject({ futureField: 1 });
  });
});
