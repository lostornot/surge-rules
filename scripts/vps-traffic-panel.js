// VPS Traffic Panel for Surge
// Fetches multiple VPS traffic endpoints and renders a compact monthly/rolling quota overview.

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function decimalGB(bytes) {
  return bytes / 1000000000;
}

function formatGB(value, digits) {
  if (!Number.isFinite(value)) return "未知";
  return `${value.toFixed(digits)}G`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function nowText(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseArgument(arg) {
  const result = {};
  String(arg || "").split(/[&;\n]/).forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    result[pair.slice(0, idx).trim()] = decodeMaybe(pair.slice(idx + 1).trim());
  });
  return result;
}

function decodeMaybe(value) {
  let current = String(value || "").trim();
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch (_) {
      break;
    }
  }
  return current.trim();
}

function base64UrlToUtf8(input) {
  let b64 = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let binary = "";
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < b64.length; i++) {
    const ch = b64.charAt(i);
    if (ch === "=") break;
    const value = alphabet.indexOf(ch);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      binary += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  let escaped = "";
  for (let i = 0; i < binary.length; i++) {
    escaped += `%${(`00${binary.charCodeAt(i).toString(16)}`).slice(-2)}`;
  }
  return decodeURIComponent(escaped);
}

function loadConfig() {
  const rawArgument = typeof $argument === "undefined" ? "" : String($argument || "");
  const args = parseArgument(rawArgument);
  const encoded = args.VPS_CONFIG_B64 || args.vps_config_b64 || "";
  if (encoded) return JSON.parse(base64UrlToUtf8(encoded));

  const simple = parseSimpleVpsList(args.VPS || args.vps || rawArgument);
  if (simple.length) return { vps: simple };

  const vps = [];
  for (let i = 1; i <= 20; i++) {
    const prefix = `VPS${i}_`;
    const name = args[`${prefix}NAME`];
    const url = args[`${prefix}URL`] || buildUrlFromParts(args, prefix);
    if (!name && !url) continue;
    if (!name || !url) continue;

    const resetType = args[`${prefix}RESET_TYPE`] || "monthly";
    const item = {
      name,
      url
    };

    if (args[`${prefix}LIMIT_GB`]) item.limit_gb = toNumber(args[`${prefix}LIMIT_GB`]);
    if (args[`${prefix}RESET_TYPE`]) {
      item.reset = { type: resetType };
      if (resetType === "rolling") {
        item.reset.start = args[`${prefix}RESET_START`];
        item.reset.days = toNumber(args[`${prefix}RESET_DAYS`]) || 30;
      } else {
        item.reset.day = toNumber(args[`${prefix}RESET_DAY`]) || 1;
      }
    }

    vps.push(item);
  }

  return vps.length ? { vps } : null;
}

function parseSimpleVpsList(value) {
  return String(value || "")
    .split("|")
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split(",").map(part => part.trim());
      const name = parts[0] || "";
      const host = parts[1] || "";
      if (!name || !host) return null;

      if (/^https?:\/\//i.test(host)) {
        return { name, url: host };
      }

      const port = parts[2] || "8787";
      const https = /^(1|true|yes|https)$/i.test(parts[3] || "");
      const scheme = https ? "https" : "http";
      const portText = port ? `:${port}` : "";
      return { name, url: `${scheme}://${host}${portText}/traffic` };
    })
    .filter(Boolean);
}

function buildUrlFromParts(args, prefix) {
  const host = args[`${prefix}HOST`];
  if (!host) return "";

  const https = /^(1|true|yes)$/i.test(args[`${prefix}HTTPS`] || "");
  const scheme = https ? "https" : "http";
  const portValue = args[`${prefix}PORT`];
  const port = portValue !== undefined ? portValue : (https ? "" : "8787");
  const rawPath = args[`${prefix}PATH`] || "/traffic";
  const path = rawPath.charAt(0) === "/" ? rawPath : `/${rawPath}`;
  const token = args[`${prefix}TOKEN`] || "";
  const base = `${scheme}://${host}${port ? `:${port}` : ""}${path}`;
  if (!token) return base;
  return appendQuery(base, { token });
}

function countryToFlag(country) {
  const code = String(country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const base = 127397;
  return String.fromCodePoint(code.charCodeAt(0) + base, code.charCodeAt(1) + base);
}

function progressBar(percent, width) {
  const filled = Math.max(0, Math.min(width, Math.round(percent / 100 * width)));
  return "●".repeat(filled) + "○".repeat(width - filled);
}

function daysBetween(start, end) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.ceil((endDay.getTime() - startDay.getTime()) / 86400000));
}

function nextMonthlyReset(now, day) {
  const resetDay = Math.max(1, Math.min(28, Math.floor(toNumber(day) || 1)));
  let next = new Date(now.getFullYear(), now.getMonth(), resetDay);
  if (next <= now) next = new Date(now.getFullYear(), now.getMonth() + 1, resetDay);
  return next;
}

function nextRollingReset(now, start, days) {
  const periodDays = Math.max(1, Math.floor(toNumber(days) || 30));
  let next = new Date(`${start}T00:00:00`);
  while (next <= now) {
    next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + periodDays);
  }
  return next;
}

function resetText(item, now) {
  if (!item.reset) return "";
  let next;
  if (item.reset.type === "rolling") {
    next = nextRollingReset(now, item.reset.start, item.reset.days);
  } else {
    next = nextMonthlyReset(now, item.reset.day);
  }
  return `${daysBetween(now, next)}天后重置`;
}

function appendQuery(url, params) {
  const pairs = [];
  Object.keys(params).forEach(key => {
    const value = params[key];
    if (value === undefined || value === null || value === "") return;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  });
  if (!pairs.length) return url;
  return `${url}${url.indexOf("?") === -1 ? "?" : "&"}${pairs.join("&")}`;
}

function requestUrlForItem(item) {
  if (item.reset && item.reset.type === "rolling") {
    return appendQuery(item.url, {
      period_start: item.reset.start,
      period_days: item.reset.days || 30
    });
  }
  return item.url;
}

function extractBytes(json, keys) {
  for (const key of keys) {
    const value = toNumber(json[key]);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function donePanel(title, content, style, icon) {
  const payload = { title, content };
  if (style) payload.style = style;
  if (icon) payload.icon = icon;
  $done(payload);
}

function renderRows(items, now) {
  let maxPercent = 0;
  const rows = items.map(item => {
    if (item.error) {
      maxPercent = Math.max(maxPercent, 100);
      return `⚠️ ${item.name || "VPS"} 查询失败\n${item.error}`;
    }

    const usedGB = decimalGB(item.rxBytes + item.txBytes);
    const limitGB = toNumber(item.limit_gb);
    if (!(limitGB > 0)) {
      maxPercent = Math.max(maxPercent, 100);
      return `⚠️ ${item.name || "VPS"} 配置缺失\nVPS 服务端未配置流量额度`;
    }

    const leftGB = Math.max(limitGB - usedGB, 0);
    const percent = limitGB > 0 ? usedGB / limitGB * 100 : 0;
    maxPercent = Math.max(maxPercent, percent);

    const flag = item.flag || countryToFlag(item.country) || "🌐";
    const reset = resetText(item, now);
    const header = `${flag} ${item.name} 剩余${formatGB(leftGB, 2)}${reset ? ` ${reset}` : ""}`;
    const usage = `${usedGB.toFixed(1)}/${formatGB(limitGB, 0)}  ${percent.toFixed(1)}%  ${progressBar(percent, 10)}`;
    return `${header}\n${usage}`;
  });

  let style = "good";
  if (maxPercent >= 90) style = "error";
  else if (maxPercent >= 70) style = "alert";
  else if (maxPercent >= 50) style = "info";

  return { content: rows.join("\n\n"), style };
}

function renderPanel() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    donePanel("VPS 流量配置错误", `模块参数解析失败：${String(e)}`, "error", "exclamationmark.triangle.fill");
    return;
  }

  const servers = config && Array.isArray(config.vps) ? config.vps : [];
  if (!servers.length) {
    donePanel(
      "VPS 流量配置缺失",
      "请填写 VPS 参数，例如：US-1446,100.79.53.68。多台用 | 分隔。",
      "error",
      "exclamationmark.triangle.fill"
    );
    return;
  }

  const now = new Date();
  const results = new Array(servers.length);
  let pending = servers.length;

  function finishOne(index, partial) {
    results[index] = partial;
    pending -= 1;
    if (pending > 0) return;

    const rendered = renderRows(results, now);
    donePanel(`VPS 流量总览｜更新 ${nowText(now)}`, rendered.content, rendered.style, "server.rack");
  }

  servers.forEach((item, index) => {
    $httpClient.get({ url: requestUrlForItem(item), timeout: item.timeout || 10, "auto-redirect": true }, (error, response, data) => {
      if (error) {
        finishOne(index, Object.assign({}, item, { error: `请求失败：${String(error)}` }));
        return;
      }

      const status = response ? response.status : "Unknown";
      if (!response || status < 200 || status >= 300) {
        finishOne(index, Object.assign({}, item, { error: `HTTP ${status}` }));
        return;
      }

      let json;
      try {
        json = JSON.parse(data);
      } catch (_) {
        finishOne(index, Object.assign({}, item, { error: "返回内容不是 JSON" }));
        return;
      }

      const rxBytes = extractBytes(json, ["rx_bytes", "rx", "download_bytes", "down_bytes"]);
      const txBytes = extractBytes(json, ["tx_bytes", "tx", "upload_bytes", "up_bytes"]);
      if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) {
        finishOne(index, Object.assign({}, item, { error: "缺少 rx_bytes/tx_bytes" }));
        return;
      }

      finishOne(index, Object.assign({}, item, {
        rxBytes,
        txBytes,
        limit_gb: json.limit_gb || item.limit_gb,
        reset: json.reset || item.reset,
        country: json.country || item.country,
        flag: json.flag || item.flag
      }));
    });
  });
}

renderPanel();
