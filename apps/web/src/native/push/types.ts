// Provider-neutral push layer. The UI and server code talk to a PushProvider;
// today only the web push provider exists (service worker + VAPID, PR54).
// A wrapped app later plugs in FCM (Android) or APNs (iOS) device tokens
// through the same interface, stored with a platform field (push_device_tokens).
export * from "../core";
