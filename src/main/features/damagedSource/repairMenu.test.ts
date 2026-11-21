// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { sourceDamageMissingCompositionOffsets } from '../../../common/features/damagedSource/index.js';
import type { SourceRepairMenuAction, SourceRepairMenuState } from '../../../common/features/damagedSource/index.js';
import { buildSourceRepairMenuItems } from './repairMenu.js';
import type { RepairMenuItem } from './repairMenu.js';

const t = (key: string) => key;

const damaged = (overrides: Partial<SourceRepairMenuState> = {}): SourceRepairMenuState => ({
  hasDamage: true,
  kinds: [sourceDamageMissingCompositionOffsets],
  repair: true,
  quality: 'smooth',
  exportRepair: true,
  ...overrides,
});

function collect(items: RepairMenuItem[], label: string): RepairMenuItem | undefined {
  for (const item of items) {
    if (item.label === label) return item;
    const nested = item.submenu && collect(item.submenu, label);
    if (nested != null) return nested;
  }
  return undefined;
}

function build(state: SourceRepairMenuState | undefined, onAction: (action: SourceRepairMenuAction) => void = () => undefined) {
  const items = buildSourceRepairMenuItems({ state, t, onAction });
  return { items, onAction };
}

describe('buildSourceRepairMenuItems', () => {
  it('says nothing can be repaired when no window has reported', () => {
    const { items } = build(undefined);
    expect(items).toStrictEqual([{ label: 'No file is open', enabled: false }]);
  });

  it('reports a healthy file instead of offering repairs', () => {
    const { items } = build(damaged({ hasDamage: false, kinds: [] }));
    expect(items).toStrictEqual([{ label: 'No damage detected in this file', enabled: false }]);
  });

  it('shows the chosen playback switch', () => {
    const repairing = build(damaged({ repair: true })).items;
    expect(collect(repairing, 'Repair this file')?.checked).toBe(true);
    expect(collect(repairing, 'Play this file as stored')?.checked).toBe(false);

    const stored = build(damaged({ repair: false })).items;
    expect(collect(stored, 'Play this file as stored')?.checked).toBe(true);
    expect(collect(stored, 'Repair this file')?.checked).toBe(false);
  });

  it('disables the resolution menu while the file plays as stored', () => {
    const { items } = build(damaged({ repair: false }));
    expect(collect(items, 'Repair resolution')?.enabled).toBe(false);
    expect(collect(items, 'Smooth (800 pixels wide)')?.enabled).toBe(false);
    expect(collect(items, 'Original resolution')?.enabled).toBe(false);
  });

  it('marks the chosen quality', () => {
    expect(collect(build(damaged({ quality: 'smooth' })).items, 'Smooth (800 pixels wide)')?.checked).toBe(true);
    expect(collect(build(damaged({ quality: 'smooth' })).items, 'Original resolution')?.checked).toBe(false);
    expect(collect(build(damaged({ quality: 'original' })).items, 'Original resolution')?.checked).toBe(true);
  });

  it('names the problem without letting it be switched on its own', () => {
    const problem = collect(build(damaged()).items, 'Missing composition time offsets (ctts)');
    expect(problem).toMatchObject({ type: 'checkbox', checked: true, enabled: false });
  });

  it('keeps naming the problem while the file plays as stored', () => {
    // The playback switch must not decide whether the file has the problem: an unchecked row would
    // read as "no damage found" (the in-app menu always lists it).
    const problem = collect(build(damaged({ repair: false })).items, 'Missing composition time offsets (ctts)');
    expect(problem).toMatchObject({ type: 'checkbox', checked: true, enabled: false });
  });

  it('mirrors the global export switch', () => {
    expect(collect(build(damaged({ exportRepair: true })).items, 'Repair exported clips too')?.checked).toBe(true);
    expect(collect(build(damaged({ exportRepair: false })).items, 'Repair exported clips too')?.checked).toBe(false);
  });

  it('sends an intent for every choice', () => {
    const actions: SourceRepairMenuAction[] = [];
    const onAction = (action: SourceRepairMenuAction) => { actions.push(action); };
    const { items } = build(damaged({ quality: 'smooth', exportRepair: true }), onAction);

    collect(items, 'Play this file as stored')?.click?.();
    collect(items, 'Repair this file')?.click?.();
    collect(items, 'Original resolution')?.click?.();
    collect(items, 'Repair exported clips too')?.click?.();

    expect(actions).toStrictEqual([
      { type: 'playback', repair: false },
      { type: 'playback', repair: true },
      { type: 'quality', quality: 'original' },
      // The checkbox flips what it shows, it does not assume the new value.
      { type: 'export', repair: false },
    ]);
  });
});
