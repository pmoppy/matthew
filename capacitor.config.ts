import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shelfscan.app',
  appName: 'ShelfScan',
  webDir: 'dist',
  android: {
    // Product photos / models are fetched over HTTPS only.
    allowMixedContent: false,
  },
};

export default config;
