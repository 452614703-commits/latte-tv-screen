(function (root) {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const saltLength = 16;
  const ivLength = 12;

  function encode(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  function decode(value, minimum, maximum) {
    if (typeof value !== "string" || value.length > Math.ceil(maximum / 3) * 4) {
      throw Error("本机保存的令牌数据无效");
    }
    const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    if (bytes.length < minimum || bytes.length > maximum) throw Error("本机保存的令牌数据无效");
    return bytes;
  }

  async function keyFor(password, salt) {
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      throw Error("请输入 12 至 256 个字符的后台密码");
    }
    const subtle = root.crypto.subtle;
    const material = await subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  function algorithm(repository, iv) {
    return { name: "AES-GCM", iv, additionalData: encoder.encode("latte-tv-screen/v1/" + repository) };
  }

  async function seal(repository, token, password) {
    const plain = encoder.encode(token);
    if (plain.length < 1 || plain.length > 512) throw Error("令牌长度无效");
    const salt = root.crypto.getRandomValues(new Uint8Array(saltLength));
    const iv = root.crypto.getRandomValues(new Uint8Array(ivLength));
    const key = await keyFor(password, salt);
    const ciphertext = await root.crypto.subtle.encrypt(algorithm(repository, iv), key, plain);
    return { version: 1, repository, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
  }

  async function open(record, repository, password) {
    if (!record || record.version !== 1 || record.repository !== repository) {
      throw Error("本机保存的令牌与当前仓库不匹配");
    }
    const salt = decode(record.salt, saltLength, saltLength);
    const iv = decode(record.iv, ivLength, ivLength);
    const ciphertext = decode(record.ciphertext, 17, 528);
    const key = await keyFor(password, salt);
    try {
      return decoder.decode(await root.crypto.subtle.decrypt(algorithm(repository, iv), key, ciphertext));
    } catch (error) {
      throw Error("密码不正确，或本机保存的令牌已损坏");
    }
  }

  const vault = { seal, open };
  if (typeof module === "object" && module.exports) module.exports = vault;
  else root.LatteCredentialVault = vault;
})(globalThis);
