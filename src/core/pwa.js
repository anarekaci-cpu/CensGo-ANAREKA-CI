import { registerSW } from "virtual:pwa-register";
import { toastInfo, toastSuccess } from "./toast.js";

export function initPwa() {
  registerSW({
    onOfflineReady() {
      toastSuccess("CensGo est prêt à fonctionner hors connexion.");
    },
    onNeedRefresh() {
      toastInfo("Une nouvelle version est disponible. Rechargez l'application pour l'utiliser.");
    }
  });
}