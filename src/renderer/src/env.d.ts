import type { HeroSiegeCompanionApi } from "../../shared/ipc";

declare const __APP_VERSION__: string;

declare global {
  interface Window {
    heroSiegeCompanion: HeroSiegeCompanionApi;
  }
}

export {};
