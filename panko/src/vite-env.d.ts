/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Address of the Panko server (Cloudflare Worker) that holds the AI key. */
  readonly VITE_PANKO_SERVER?: string;
}
