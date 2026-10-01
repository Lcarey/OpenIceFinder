export function registerWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled) window.location.reload();
    controlled = true;
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      // Private browsing/storage limits must not prevent normal online use.
    });
  });
}
