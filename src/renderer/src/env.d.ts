import type { HeroSiegeCompanionApi } from "../../shared/ipc";

declare global {
  interface Window {
    heroSiegeCompanion: HeroSiegeCompanionApi;
  }
}

export {};
