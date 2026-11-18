/** Bits that differ in the Android app (Capacitor) from the browser. */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/** Run `handler` on the Android back button; return false from it to let the app close. Returns an unsubscribe. */
export function onBackButton(handler: () => boolean): () => void {
  if (!isNative) return () => {};
  let remove = () => {};
  let cancelled = false;
  import('@capacitor/app').then(({ App }) =>
    App.addListener('backButton', () => {
      if (!handler()) App.exitApp();
    }).then((h) => {
      if (cancelled) h.remove();
      else remove = () => h.remove();
    }),
  );
  return () => {
    cancelled = true;
    remove();
  };
}

/** Save a text file to the app cache and open Android's share sheet (Drive, email, WhatsApp, Files…). */
export async function shareFile(name: string, text: string, title: string) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const saved = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title, files: [saved.uri], dialogTitle: title });
}
