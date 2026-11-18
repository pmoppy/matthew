import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.panko.app',
  appName: 'Panko',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
