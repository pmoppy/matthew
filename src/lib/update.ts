/**
 * The APK can't update itself silently, so it checks GitHub Releases on launch
 * and offers the newer APK. Installing it over the top keeps all app data.
 */
export interface UpdateInfo {
  build: number;
  url: string;
}

export async function checkForApkUpdate(): Promise<UpdateInfo | null> {
  if (!__NATIVE__ || !__BUILD_NUMBER__) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${__REPO__}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const rel = (await res.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const build = Number(/(\d+)$/.exec(rel.tag_name ?? '')?.[1] ?? 0);
    const apk = rel.assets?.find((a) => a.name.endsWith('.apk'));
    if (!apk || build <= __BUILD_NUMBER__) return null;
    return { build, url: apk.browser_download_url };
  } catch {
    return null; // offline in-store: try again next launch
  }
}
