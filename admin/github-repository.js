(function (root) {
  "use strict";

  const data = typeof module === "object" && module.exports
    ? require("../screen-data.js")
    : root.LatteScreenData;
  const MANIFEST = "data/screen.json";

  function encodeBranch(name) {
    return name.split("/").map(encodeURIComponent).join("/");
  }

  function decodeContent(file) {
    if (!file || file.encoding !== "base64" || typeof file.content !== "string") {
      throw Error("仓库缺少可读取的发布清单");
    }
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), ch => ch.charCodeAt(0));
    return data.validateScreen(JSON.parse(new TextDecoder().decode(bytes)));
  }

  async function blobBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 16384) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 16384)));
    }
    return btoa(chunks.join(""));
  }

  class GitHubRepository {
    constructor(fullName, token, fetcher) {
      if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw Error("请填写 账号名/仓库名");
      if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) throw Error("请填写 GitHub 细粒度令牌");
      this.apiUrl = "https://api.github.com/repos/" + fullName.split("/").map(encodeURIComponent).join("/");
      this.fetcher = fetcher || root.fetch.bind(root);
      this.token = token;
      this.branch = "";
      this.saved = null;
    }

    async request(path, method, body) {
      const options = {
        method: method || "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + this.token
        },
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(45000)
      };
      if (body !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      const response = await this.fetcher(this.apiUrl + path, options);
      if (!response.ok) {
        const status = response.status;
        if (status === 401) throw Error("令牌无效或已过期");
        if (status === 403) throw Error("GitHub 拒绝访问。请检查仓库授权、Contents 写入权限或请求限制");
        if (status === 404) throw Error("未找到仓库或发布清单。请先上传网站文件并检查仓库授权");
        if (status === 409 || status === 422) {
          throw Error("GitHub 拒绝更新。请重新读取仓库，并检查是否启用了分支保护");
        }
        throw Error("GitHub 请求失败，HTTP " + status);
      }
      return response.json();
    }

    async head() {
      const ref = await this.request("/git/ref/heads/" + encodeBranch(this.branch));
      return ref.object.sha;
    }

    async readAt(sha) {
      return decodeContent(await this.request("/contents/" + MANIFEST + "?ref=" + encodeURIComponent(sha)));
    }

    async connect() {
      const repository = await this.request("");
      this.branch = repository.default_branch;
      if (typeof this.branch !== "string" || !this.branch) throw Error("仓库还没有默认分支");
      this.saved = await this.readAt(await this.head());
      return this.saved;
    }

    async publish(value, pending, onProgress) {
      if (!this.saved) throw Error("请先连接仓库");
      const next = data.validateScreen(value);
      const head = await this.head();
      const latest = await this.readAt(head);
      if (JSON.stringify(latest) !== JSON.stringify(this.saved)) {
        throw Error("仓库内容已在其他窗口修改。请刷新后台重新读取，再编辑发布");
      }
      const base = await this.request("/git/commits/" + head);
      const oldIds = new Set((latest.posters || []).map(data.assetId));
      const keptIds = new Set((next.posters || []).map(data.assetId));
      const tree = [];
      for (const id of keptIds) {
        if (oldIds.has(id)) continue;
        const blob = pending.get(id);
        if (!blob) throw Error("新海报文件缺失，请重新选择图片");
        if (onProgress) onProgress("正在上传海报");
        const uploaded = await this.request("/git/blobs", "POST", {
          content: await blobBase64(blob),
          encoding: "base64"
        });
        tree.push({ path: "data/media/" + id, mode: "100644", type: "blob", sha: uploaded.sha });
      }
      for (const id of oldIds) {
        if (!keptIds.has(id)) tree.push({ path: "data/media/" + id, mode: "100644", type: "blob", sha: null });
      }
      tree.push({ path: MANIFEST, mode: "100644", type: "blob", content: JSON.stringify(next, null, 2) + "\n" });
      if (onProgress) onProgress("正在保存播放清单");
      const createdTree = await this.request("/git/trees", "POST", { base_tree: base.tree.sha, tree });
      const commit = await this.request("/git/commits", "POST", {
        message: "Update Latte TV screen " + next.revision,
        tree: createdTree.sha,
        parents: [head]
      });
      await this.request("/git/refs/heads/" + encodeBranch(this.branch), "PATCH", {
        sha: commit.sha,
        force: false
      });
      this.saved = next;
      return commit.sha;
    }
  }

  if (typeof module === "object" && module.exports) module.exports = GitHubRepository;
  else root.LatteGitHubRepository = GitHubRepository;
})(globalThis);
