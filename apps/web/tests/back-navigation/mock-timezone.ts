export const setReceiveTimezoneUser = () => { };
export const syncReceiveTimezone = async () => { };
export const invalidateReceiveTimezone = () => { };
export const timezoneDevice = () => 'synthetic-device';
const state = { enabled: false, windows: [], mode: 'fixed', timezone: 'Europe/Copenhagen', revision: 1, is_controller: true };
export const readReceiveSettings = async () => ({ ...state });
export const saveReceiveSettings = async () => ({ ...state });
