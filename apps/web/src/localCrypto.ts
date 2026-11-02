// AES-GCM helpers for the local encrypted cache (no DOM/IndexedDB types, testable in Deno).
export async function seal(key: CryptoKey, value: unknown, aad: string): Promise<{ iv: Uint8Array; ct: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv, ct };
}
export async function unseal<T>(key: CryptoKey, box: { iv: Uint8Array; ct: ArrayBuffer }, aad: string): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.iv as BufferSource, additionalData: new TextEncoder().encode(aad) }, key, box.ct);
  return JSON.parse(new TextDecoder().decode(pt));
}
