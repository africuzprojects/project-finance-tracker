/**
 * Cloud retrieve conflict UI — expects #modal-cloud-conflict in the page.
 */
(function (global) {
  function prompt(updatedAtIso) {
    const ov = document.getElementById("modal-cloud-conflict");
    const msg = document.getElementById("cloud-conflict-message");
    if (!ov || !msg) {
      return Promise.resolve("keep");
    }
    const hint = updatedAtIso
      ? new Date(updatedAtIso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "unknown time";
    msg.textContent =
      "This device and your cloud backup both have data. Cloud last saved: " +
      hint +
      ". Same project, asset, or transaction id in both keeps the row with the newer date (or this device if tied).";

    return new Promise((resolve) => {
      let done = false;
      const keepBtn = document.getElementById("btn-cloud-conflict-keep");
      const replaceBtn = document.getElementById("btn-cloud-conflict-replace");
      const mergeBtn = document.getElementById("btn-cloud-conflict-merge");

      function finish(v) {
        if (done) return;
        done = true;
        keepBtn?.removeEventListener("click", onKeep);
        replaceBtn?.removeEventListener("click", onReplace);
        mergeBtn?.removeEventListener("click", onMerge);
        ov.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey);
        ov.classList.remove("open");
        resolve(v);
      }

      const onKeep = () => finish("keep");
      const onReplace = () => finish("replace");
      const onMerge = () => finish("merge");
      const onBackdrop = (e) => {
        if (e.target === ov) finish("keep");
      };
      const onKey = (e) => {
        if (e.key === "Escape") finish("keep");
      };

      keepBtn?.addEventListener("click", onKeep);
      replaceBtn?.addEventListener("click", onReplace);
      mergeBtn?.addEventListener("click", onMerge);
      ov.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
      ov.classList.add("open");
    });
  }

  global.PFTCloudConflict = { prompt };
})(typeof window !== "undefined" ? window : globalThis);
