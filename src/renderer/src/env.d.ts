import type { HeroSiegeCompanionApi } from "../../shared/ipc";

declare global {
  const __APP_VERSION__: string;

  interface Window {
    heroSiegeCompanion: HeroSiegeCompanionApi;
  }
}

export {};
