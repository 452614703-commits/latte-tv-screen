(function (root) {
  "use strict";

  const MAX_POSTERS = 20;
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_DIMENSION = 2560;
  const PRODUCT = "latte-tv-screen";

  function day(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("请输入有效的基准日期");
    const date = new Date(value + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw Error("请输入有效的基准日期");
    }
    return date.getTime();
  }

  function validateDuty(value) {
    if (value === null) return null;
    if (!value || !Array.isArray(value.names) || value.names.length < 1 || value.names.length > 30) {
      throw Error("值班名单需要有 1 至 30 人");
    }
    const names = value.names.map(function (name) {
      if (typeof name !== "string" || !name || name !== name.trim() || name.length > 20 ||
          /[\u0000-\u001f\u007f]/.test(name)) throw Error("每位人员需填写 1 至 20 字的姓名");
      return name;
    });
    if (new Set(names).size !== names.length) throw Error("值班名单中有重复姓名");
    day(value.anchorDate);
    if (!names.includes(value.anchorPerson)) throw Error("请选择基准日期的值班人员");
    return { names, anchorDate: value.anchorDate, anchorPerson: value.anchorPerson };
  }

  function assetId(poster) {
    return poster.sha256 + "." + poster.ext;
  }

  function validateScreen(value) {
    if (!value || value.product !== PRODUCT || value.schema !== 1 ||
        typeof value.revision !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.revision)) {
      throw Error("这不是拿铁信息屏的发布清单");
    }
    const duty = validateDuty(value.duty);
    let posters = null;
    if (value.posters !== null) {
      if (!Array.isArray(value.posters) || value.posters.length > MAX_POSTERS) throw Error("最多发布 20 张海报");
      const ids = new Set();
      posters = value.posters.map(function (item) {
        if (!item || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) ||
            !["jpg", "png"].includes(item.ext) || !Number.isInteger(item.bytes) ||
            item.bytes < 1 || item.bytes > MAX_IMAGE_BYTES ||
            typeof item.label !== "string" || !item.label || item.label.length > 80) {
          throw Error("海报清单含有无效记录");
        }
        const id = assetId(item);
        if (ids.has(id)) throw Error("有重复海报");
        ids.add(id);
        return { sha256: item.sha256, ext: item.ext, bytes: item.bytes, label: item.label };
      });
    }
    return { product: PRODUCT, schema: 1, revision: value.revision, duty, posters };
  }

  function personOn(duty, date) {
    const length = duty.names.length;
    const shift = Math.round((day(date) - day(duty.anchorDate)) / 86400000);
    const start = duty.names.indexOf(duty.anchorPerson);
    return duty.names[((start + shift) % length + length) % length];
  }

  async function sha256(buffer) {
    if (!root.crypto || !root.crypto.subtle) throw Error("请在 HTTPS 网站或电脑本地预览中打开");
    const bytes = new Uint8Array(await root.crypto.subtle.digest("SHA-256", buffer));
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }

  const api = { MAX_POSTERS, MAX_IMAGE_BYTES, MAX_DIMENSION, PRODUCT, assetId, validateDuty, validateScreen, personOn, sha256 };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LatteScreenData = api;
})(globalThis);
