import type { ParamsByFile } from '../../types';
import compareStrings from '../../../../common/features/patchExport/stringOrder';

/**
Stable, JSON-safe form of `ParamsByFile` for the export signature (fork-owned).

`ParamsByFile` holds Maps (`paramsByStream`), and `JSON.stringify` turns a Map into `{}`. Passing
the Map entries to the hash would therefore drop every stream-level setting (disposition, crop,
aspect ratio, bitstream filters, tags): changing one of them would leave the signature unchanged
and the previous result would be reused. This flattens the Maps first, in a deterministic order.
*/
export default function serializeParamsByFile(paramsByFile: ParamsByFile) {
  // A code-point order on purpose: the resulting order is hashed into the export signature, so it
  // must not depend on the machine's collation (otherwise another computer re-cuts every result).
  return [...paramsByFile.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([fileId, { metadata, offset, paramsByStream }]) => ({
      fileId,
      metadata: Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => compareStrings(left, right))),
      offset: offset ?? null,
      paramsByStream: [...paramsByStream.entries()]
        .sort(([left], [right]) => left - right)
        .map(([streamId, params]) => ({ streamId, ...params })),
    }));
}
