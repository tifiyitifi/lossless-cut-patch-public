import type { PatchNameContext } from '../../../../common/features/patchPlayer';
import { applyLabelToNameContext } from '../../../../common/features/patchPlayer';
import { renderRuleCutName } from '../../../../common/features/patchData/cutName';
import safeishEval from '../../worker/eval';

const { join, parse } = window.require('node:path');

// Keep in sync with `maxFileNameLength` in util/outputNameTemplate.
const maxFileNameLength = 250;

function truncateLastPathSegment(name: string, truncate: boolean) {
  if (!truncate) return name;
  const parsed = parse(name);
  return join(parsed.dir, parsed.base.slice(0, maxFileNameLength));
}

/**
Re-render a cut result's file name from the naming system it was exported with, with a new label.

Two systems exist: the upstream `${}` template (records written before patch named cut results,
and base mode) and the patch `{token}` rule. The rule branch gets the whole export view back - the
clips, the timestamp and the suffix the export appended - so renaming a label keeps the name the
file already has everywhere else, including the number + time that keeps duplicates apart.

Returns the full path the export would have used.
*/
export default async function renderResultPath(nameContext: PatchNameContext, label: string) {
  if (nameContext.kind === 'rule') {
    const name = renderRuleCutName(nameContext, label);
    if (name == null) throw new Error('The name rule did not produce a file name');
    return join(nameContext.outputDir, name);
  }

  const context = applyLabelToNameContext(nameContext, label);
  const rendered = await safeishEval(`\`${nameContext.template}\``, context as unknown as Record<string, unknown>);

  if (typeof rendered !== 'string' || rendered.length === 0) {
    throw new Error('The name template did not produce a file name');
  }

  return join(nameContext.outputDir, truncateLastPathSegment(rendered, nameContext.safeOutputFileName));
}
