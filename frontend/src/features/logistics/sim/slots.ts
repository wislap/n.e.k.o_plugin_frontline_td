// Slot-array helpers: a CargoStore carries 4 slots exposed as per-slot
// field groups (cargo0..3, cap0..3, ...). sget/sset index them by slot.
import type { ComponentWriter, ReadonlyNumberArray, WriteView } from '../../../kernel/index';
import type { CargoStore } from './components';

export type CargoFields = (typeof CargoStore)['fields'];
export type CargoView = WriteView<CargoFields>;
export type CargoRead = { [K in keyof CargoFields]: ReadonlyNumberArray };
export type ModWriter = ComponentWriter<{ value: 'i32' }>;

const SLOT_FIELDS = {
  cargo: ['cargo0', 'cargo1', 'cargo2', 'cargo3'],
  cap: ['cap0', 'cap1', 'cap2', 'cap3'],
  amt: ['amt0', 'amt1', 'amt2', 'amt3'],
  cls: ['cls0', 'cls1', 'cls2', 'cls3'],
  flags: ['flags0', 'flags1', 'flags2', 'flags3'],
  since: ['since0', 'since1', 'since2', 'since3'],
  rate: ['rate0', 'rate1', 'rate2', 'rate3'],
  unmet: ['unmet0', 'unmet1', 'unmet2', 'unmet3'],
} as const;
export type SlotGroup = keyof typeof SLOT_FIELDS;

export function sget(store: CargoRead, group: SlotGroup, i: number, id: number): number {
  const key = SLOT_FIELDS[group][i];
  return key === undefined ? 0 : (store[key][id] ?? 0);
}

export function sset(store: CargoView, group: SlotGroup, i: number, id: number, v: number): void {
  const key = SLOT_FIELDS[group][i];
  if (key !== undefined) {
    (store[key] as Int32Array)[id] = v;
  }
}
