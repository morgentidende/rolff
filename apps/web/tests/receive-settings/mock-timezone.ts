export function defaultReceiveWindows(): ReceiveWindow[] {
  return Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, start_minute: 18 * 60, end_minute: 19 * 60 }));
}
export type ReceiveWindow = { weekday: number; start_minute: number; end_minute: number };
export const DEFAULT_RECEIVE_START_MINUTE = 18 * 60;
export const DEFAULT_RECEIVE_END_MINUTE = 19 * 60;
export const setReceiveTimezoneUser = () => { };
export const syncReceiveTimezone = async () => { };
export const invalidateReceiveTimezone = () => { };
export const timezoneDevice = () => 'synthetic-device';
export type ReceiveSettingsState = { configured: boolean; timezone: string | null; mode: 'auto' | 'fixed'; revision: number; enabled: boolean; windows: ReceiveWindow[]; is_controller: boolean; synced_at: string | null };
const state = { configured: true, enabled: false, windows: [] as ReceiveWindow[], mode: 'fixed' as const, timezone: 'Europe/Copenhagen', revision: 1, is_controller: true, synced_at: null as string | null };
export const readReceiveSettings = async () => ({ ...state, windows: state.windows.map(w => ({ ...w })) });
export const saveReceiveSettings = async (_uid: string, _conv: string, _base: unknown, changes: { enabled: boolean; windows: ReceiveWindow[]; mode: 'auto' | 'fixed'; timezone: string; takeOver: boolean }) => {
  (globalThis as any).__receiveSaves = ((globalThis as any).__receiveSaves ?? 0) + 1;
  (globalThis as any).__receiveLastSave = changes;
  (globalThis as any).__receiveLastConv = _conv;
  if (changes.enabled && !changes.windows.length) throw new Error('windows_required');
  state.enabled = changes.enabled;
  state.windows = changes.windows.map(w => ({ ...w }));
  state.mode = changes.mode;
  state.timezone = changes.timezone;
  state.revision += 1;
  return readReceiveSettings();
};
export function __resetReceiveSettingsMock(next?: Partial<typeof state>) {
  state.configured = true;
  state.enabled = false;
  state.windows = [];
  state.mode = 'fixed';
  state.timezone = 'Europe/Copenhagen';
  state.revision = 1;
  state.is_controller = true;
  state.synced_at = null;
  Object.assign(state, next ?? {});
}

;(globalThis as any).__resetReceiveSettingsMock = __resetReceiveSettingsMock;
