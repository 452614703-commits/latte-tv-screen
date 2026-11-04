(function () {
  "use strict";

  const data = window.LatteScreenData;
  const settings = document.querySelector(".settings-subtitle");
  let assets = new Map();
  let active = null;
  let posterKey;
  let dutyKey;

  async function get(path) {
    const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error("HTTP " + response.status);
    return response;
  }

  async function loadPoster(poster) {
    const id = data.assetId(poster);
    const response = await get("data/media/" + id);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== poster.bytes || await data.sha256(buffer) !== poster.sha256) {
      throw Error("海报校验失败");
    }
    const blob = new Blob([buffer], { type: poster.ext === "png" ? "image/png" : "image/jpeg" });
    const src = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = src;
      await image.decode();
      if (Math.max(image.naturalWidth, image.naturalHeight) > data.MAX_DIMENSION) throw Error("海报尺寸超限");
      return { id, src, color: v29ExtractDominantColor(image) || V29_DEFAULT_COLOR };
    } catch (error) {
      URL.revokeObjectURL(src);
      throw error;
    }
  }

  async function sync() {
    const added = [];
    try {
      const response = await get("data/screen.json?_=" + Date.now());
      const value = data.validateScreen(await response.json());
      if (!active || value.revision !== active.revision) {
        const posters = value.posters || [];
        const nextPosterKey = JSON.stringify(posters.map(data.assetId));
        if (nextPosterKey !== posterKey) {
          const next = new Map();
          for (const poster of posters) {
            const id = data.assetId(poster);
            let image = assets.get(id);
            if (!image) {
              image = await loadPoster(poster);
              added.push(image.src);
            }
            next.set(id, image);
          }
          window.LatteSetPosters([...next.values()], false);
          const oldAssets = assets;
          assets = next;
          posterKey = nextPosterKey;
          setTimeout(() => {
            for (const image of oldAssets.values()) {
              if (!assets.has(image.id) || assets.get(image.id).src !== image.src) URL.revokeObjectURL(image.src);
            }
          }, 3500);
        }
        const nextDutyKey = JSON.stringify(value.duty);
        if (nextDutyKey !== dutyKey) {
          window.LatteApplyDutyConfig(value.duty);
          dutyKey = nextDutyKey;
        }
        active = value;
      }
      settings.textContent = active.revision === "initial" ? "等待从后台发布海报和名单。" : "已同步在线名单与海报设置。";
    } catch (error) {
      for (const src of added) {
        if (![...assets.values()].some(image => image.src === src)) URL.revokeObjectURL(src);
      }
      settings.textContent = active ? "暂时无法更新，继续显示上次发布内容。" : "暂时无法读取，请确认信息屏已在 GitHub Pages 部署。";
    } finally {
      setTimeout(sync, 15000);
    }
  }

  const admin = document.getElementById("selectPosterBtn");
  admin.addEventListener("click", event => {
    event.stopImmediatePropagation();
    window.location.assign("./admin/");
  }, true);
  document.getElementById("deletePosterBtn").hidden = true;
  sync();
})();
