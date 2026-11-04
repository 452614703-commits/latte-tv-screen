(function () {
  "use strict";

  const data = window.LatteScreenData;
  const byId = id => document.getElementById(id);
  const ui = {
    connection: byId("connection"), repository: byId("repository"), token: byId("token"),
    editor: byId("editor"), useDuty: byId("use-duty"), usePosters: byId("use-posters"),
    dutyEditor: byId("duty-editor"), posterEditor: byId("poster-editor"),
    roster: byId("roster"), posters: byId("posters"), date: byId("anchor-date"),
    person: byId("anchor-person"), upload: byId("upload"), publish: byId("publish"),
    status: byId("status"), draft: byId("draft")
  };
  const pending = new Map();
  const previews = new Map();
  let repository;
  let posters = [];
  let names = [];
  let busy = false;
  let dirty = false;
  let monitor = 0;

  function status(message, error) {
    ui.status.textContent = message;
    ui.status.classList.toggle("error", Boolean(error));
  }

  function dateInShanghai(offset) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(Date.now() + offset * 86400000);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  }

  function setDirty(value) {
    dirty = value;
    ui.draft.textContent = value ? "有待发布的修改" : "没有待发布的修改";
    ui.publish.disabled = busy || !dirty;
    if (value) monitor++;
  }

  function setBusy(value) {
    busy = value;
    ui.editor.disabled = value || !repository;
    for (const control of ui.connection.elements) control.disabled = value;
    ui.publish.disabled = value || !dirty;
  }

  function control(label, action, disabled) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.disabled = Boolean(disabled);
    element.addEventListener("click", action);
    return element;
  }

  function row(list, index, change) {
    const item = document.createElement("li");
    const number = document.createElement("span");
    number.className = "row-index";
    number.textContent = String(index + 1);
    item.append(number);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    function move(offset) {
      const [value] = list.splice(index, 1);
      list.splice(index + offset, 0, value);
      change();
    }
    actions.append(
      control("上移", () => move(-1), index === 0),
      control("下移", () => move(1), index === list.length - 1),
      control("移除", () => {
        const [removed] = list.splice(index, 1);
        if (list === posters) removePreview(data.assetId(removed));
        change();
      })
    );
    return { item, actions };
  }

  function dutyDraft() {
    return {
      names: names.map(name => name.trim()), anchorDate: ui.date.value, anchorPerson: ui.person.value
    };
  }

  function dutyPreview() {
    try {
      const duty = data.validateDuty(dutyDraft());
      byId("duty-preview").textContent = "北京时间 · 今日 " + data.personOn(duty, dateInShanghai(0))
        + " · 明日 " + data.personOn(duty, dateInShanghai(1));
    } catch (error) {
      byId("duty-preview").textContent = error.message;
    }
  }

  function anchorOptions(selected) {
    const choices = [...new Set(names.map(name => name.trim()).filter(Boolean))];
    ui.person.replaceChildren(...choices.map(name => new Option(name, name)));
    if (choices.includes(selected)) ui.person.value = selected;
    dutyPreview();
  }

  function renderRoster() {
    ui.roster.replaceChildren(...names.map((name, index) => {
      const { item, actions } = row(names, index, () => { renderRoster(); setDirty(true); });
      const input = document.createElement("input");
      input.value = name;
      input.maxLength = 20;
      input.placeholder = "姓名";
      input.setAttribute("aria-label", "第 " + (index + 1) + " 位值班人员");
      input.addEventListener("input", () => {
        const previous = names[index].trim();
        const selected = ui.person.value;
        names[index] = input.value;
        anchorOptions(previous === selected ? input.value.trim() : selected);
        setDirty(true);
      });
      item.append(input, actions);
      return item;
    }));
    anchorOptions(ui.person.value);
    byId("add-person").disabled = names.length >= 30;
  }

  function removePreview(id) {
    if (previews.has(id)) URL.revokeObjectURL(previews.get(id));
    previews.delete(id);
    pending.delete(id);
  }

  function renderPosters() {
    ui.posters.replaceChildren(...posters.map((poster, index) => {
      const id = data.assetId(poster);
      const { item, actions } = row(posters, index, () => { renderPosters(); setDirty(true); });
      const image = document.createElement("img");
      image.alt = "";
      image.src = previews.get(id) || "../data/media/" + id;
      const label = document.createElement("span");
      label.className = "poster-label";
      label.textContent = poster.label;
      item.append(image, label, actions);
      return item;
    }));
    byId("poster-count").textContent = posters.length + " / " + data.MAX_POSTERS;
    ui.upload.disabled = posters.length >= data.MAX_POSTERS;
  }

  function renderSections() {
    ui.dutyEditor.hidden = !ui.useDuty.checked;
    ui.posterEditor.hidden = !ui.usePosters.checked;
    byId("duty-local").hidden = ui.useDuty.checked;
    byId("posters-local").hidden = ui.usePosters.checked;
  }

  function load(value) {
    for (const id of previews.keys()) removePreview(id);
    ui.useDuty.checked = value.duty !== null;
    ui.usePosters.checked = value.posters !== null;
    names = value.duty ? value.duty.names.slice() : [""];
    ui.date.value = value.duty ? value.duty.anchorDate : dateInShanghai(0);
    renderRoster();
    if (value.duty) anchorOptions(value.duty.anchorPerson);
    posters = value.posters ? value.posters.slice() : [];
    renderPosters();
    renderSections();
    setDirty(false);
  }

  async function importPoster(file) {
    if (file.size > 18 * 1024 * 1024) throw Error("原图需小于 18 MB");
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isJpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
    const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte);
    if (!isJpeg && !isPng) throw Error("只支持 JPG 和 PNG");
    const localUrl = URL.createObjectURL(file);
    let blob;
    try {
      const image = new Image();
      image.src = localUrl;
      await image.decode();
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      let scale = Math.min(1, data.MAX_DIMENSION / Math.max(width, height));
      if (file.size <= data.MAX_IMAGE_BYTES && scale === 1) blob = file;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      for (let attempt = 0; !blob && attempt < 7; attempt++) {
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const resized = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .88));
        if (resized && resized.size <= data.MAX_IMAGE_BYTES) blob = resized;
        scale *= .78;
      }
    } finally {
      URL.revokeObjectURL(localUrl);
    }
    if (!blob) throw Error("无法压缩该图片");
    const poster = {
      sha256: await data.sha256(await blob.arrayBuffer()),
      ext: blob === file && isPng ? "png" : "jpg",
      bytes: blob.size,
      label: file.name.trim().slice(0, 80) || "海报"
    };
    const id = data.assetId(poster);
    if (posters.some(item => data.assetId(item) === id)) throw Error("已在播放列表中");
    pending.set(id, blob);
    previews.set(id, URL.createObjectURL(blob));
    posters.push(poster);
  }

  async function watchPages(revision, operation) {
    for (let attempt = 0; attempt < 18; attempt++) {
      if (operation !== monitor) return;
      try {
        const response = await fetch("../data/screen.json?check=" + Date.now(), {
          cache: "no-store", signal: AbortSignal.timeout(5000)
        });
        if (response.ok && data.validateScreen(await response.json()).revision === revision) {
          if (operation === monitor) status("网页已发布新内容。已连接的电视将在下次同步时读取。");
          return;
        }
      } catch (error) {
        // GitHub Pages can serve the previous revision during deployment.
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (operation === monitor) status("GitHub 已保存。网页部署仍待确认，可在仓库的 Actions 页面查看进度。");
  }

  ui.connection.addEventListener("submit", async event => {
    event.preventDefault();
    if (dirty && !window.confirm("重新读取会放弃本页待发布的修改。继续读取？")) return;
    const token = ui.token.value.trim();
    ui.token.value = "";
    monitor++;
    setBusy(true);
    status("正在读取仓库");
    try {
      const next = new window.LatteGitHubRepository(ui.repository.value.trim(), token);
      const value = await next.connect();
      repository = next;
      load(value);
      status("仓库已连接，可以编辑并发布。");
    } catch (error) {
      status(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  ui.useDuty.addEventListener("change", () => { renderSections(); setDirty(true); });
  ui.usePosters.addEventListener("change", () => { renderSections(); setDirty(true); });
  ui.date.addEventListener("change", () => { dutyPreview(); setDirty(true); });
  ui.person.addEventListener("change", () => { dutyPreview(); setDirty(true); });
  byId("add-person").addEventListener("click", () => {
    names.push("");
    renderRoster();
    ui.roster.lastElementChild.querySelector("input").focus();
    setDirty(true);
  });

  ui.upload.addEventListener("change", async () => {
    const files = Array.from(ui.upload.files);
    ui.upload.value = "";
    const failures = [];
    setBusy(true);
    status("正在检查海报");
    try {
      for (const file of files) {
        if (posters.length >= data.MAX_POSTERS) {
          failures.push("播放列表已满");
          break;
        }
        try {
          await importPoster(file);
          setDirty(true);
        } catch (error) {
          failures.push(file.name + " · " + error.message);
        }
      }
      renderPosters();
      status(failures.join("。") || "海报已加入草稿，发布后才会显示。", failures.length > 0);
    } finally {
      setBusy(false);
    }
  });

  ui.publish.addEventListener("click", async () => {
    if (busy || !dirty) return;
    setBusy(true);
    monitor++;
    try {
      const value = data.validateScreen({
        product: data.PRODUCT, schema: 1, revision: crypto.randomUUID(),
        duty: ui.useDuty.checked ? dutyDraft() : null,
        posters: ui.usePosters.checked ? posters : null
      });
      const commit = await repository.publish(value, pending, status);
      load(value);
      status("GitHub 已保存 " + commit.slice(0, 7) + "，正在等待网页部署。");
      watchPages(value.revision, monitor);
    } catch (error) {
      status(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  if (location.hostname.endsWith(".github.io")) {
    const owner = location.hostname.split(".")[0];
    const firstPart = location.pathname.split("/").filter(Boolean)[0];
    ui.repository.value = owner + "/" + (firstPart && firstPart !== "admin" ? firstPart : owner + ".github.io");
    ui.repository.readOnly = true;
  }
})();
