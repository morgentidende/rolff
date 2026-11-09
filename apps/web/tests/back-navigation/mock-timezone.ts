export const setReceiveTimezoneUser = () => { };
export const syncReceiveTimezone = async () => { };
export const invalidateReceiveTimezone = () => { };
export const timezoneDevice = () => 'synthetic-device';
export type ReceiveWindow = { weekday: number; start_minute: number; end_minute: number };
export const DEFAULT_RECEIVE_START_MINUTE = 18 * 60;
export const DEFAULT_RECEIVE_END_MINUTE = 19 * 60;
export function defaultReceiveWindows(): ReceiveWindow[] {
  return Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, start_minute: DEFAULT_RECEIVE_START_MINUTE, end_minute: DEFAULT_RECEIVE_END_MINUTE }));
}
const state = { configured: true, enabled: false, windows: [] as ReceiveWindow[], mode: 'fixed' as const, timezone: 'Europe/Copenhagen', revision: 1, is_controller: true, synced_at: null as string | null };
export const readReceiveSettings = async () => ({ ...state, windows: state.windows.map(w => ({ ...w })) });
export const saveReceiveSettings = async () => ({ ...state, windows: state.windows.map(w => ({ ...w })) });
