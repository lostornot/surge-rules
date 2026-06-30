// BandwagonHost / KiwiVM Traffic Panel for Surge
// Configure this script from a private .sgmodule. Do not commit real VEID/API keys.

const API_URL = "https://api.64clouds.com/v1/getServiceInfo";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
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

function parseArgument(arg) {
  const result = {};
  String(arg || "").split(/[&;\n]/).forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) result[key] = decodeMaybe(value);
  });
  return result;
}

function loadServices() {
  const rawArgument = typeof $argument === "undefined" ? "" : String($argument || "");
  const args = parseArgument(rawArgument);
  const services = [];

  for (let i = 1; i <= 20; i++) {
    const prefix = `BWG${i}_`;
    const name = args[`${prefix}NAME`];
    const veid = args[`${prefix}VEID`];
    const apiKey = args[`${prefix}API_KEY`];
    if (!name && !veid && !apiKey) continue;
    services.push({
      name: name || `BWG ${i}`,
      flag: args[`${prefix}FLAG`] || "",
      veid,
      apiKey,
      timeout: toNumber(args[`${prefix}TIMEOUT`]) || 15
    });
  }

  return services;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function nowText(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function decimalGB(bytes) {
  return bytes / 1000000000;
}

function formatGB(value) {
  if (!Number.isFinite(value)) return "未知";
  return `${value.toFixed(2)}G`;
}

function progressBar(percent, width) {
  const filled = Math.max(0, Math.min(width, Math.round(percent / 100 * width)));
  return "●".repeat(filled) + "○".repeat(width - filled);
}

function resetDaysText(resetSeconds, now) {
  const seconds = toNumber(resetSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "重置未知";
  const resetAt = new Date(seconds * 1000);
  const days = Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 86400000));
  return `还剩${days}天`;
}

function donePanel(title, content, style, icon) {
  const payload = { title, content };
  if (style) payload.style = style;
  if (icon) payload.icon = icon;
  $done(payload);
}

function encodedBody(service) {
  return `veid=${encodeURIComponent(service.veid)}&api_key=${encodeURIComponent(service.apiKey)}`;
}

function serviceError(service) {
  if (!service.veid || !service.apiKey) {
    return "缺少 VEID 或 API_KEY";
  }
  return "";
}

function parseTraffic(service, data) {
  let json;
  try {
    json = JSON.parse(data);
  } catch (_) {
    return Object.assign({}, service, { error: "返回内容不是 JSON" });
  }

  const apiError = toNumber(json.error);
  if (Number.isFinite(apiError) && apiError !== 0) {
    return Object.assign({}, service, { error: json.message || `API 错误 ${apiError}` });
  }

  const multiplier = toNumber(json.monthly_data_multiplier) || 1;
  const quotaBytes = toNumber(json.plan_monthly_data) * multiplier;
  const usedBytes = toNumber(json.data_counter) * multiplier;

  if (!(quotaBytes > 0) || !Number.isFinite(usedBytes)) {
    return Object.assign({}, service, { error: "缺少流量字段" });
  }

  return Object.assign({}, service, {
    usedBytes,
    quotaBytes,
    resetAt: json.data_next_reset
  });
}

function renderRows(items, now) {
  let maxPercent = 0;
  const rows = items.map(item => {
    if (item.error) {
      maxPercent = Math.max(maxPercent, 100);
      return `${item.flag || "⚠️"} ${item.name} 查询失败\n${item.error}\n剩余流量 ${nowText(now)}`;
    }

    const usedGB = decimalGB(item.usedBytes);
    const quotaGB = decimalGB(item.quotaBytes);
    const remainingGB = Math.max(quotaGB - usedGB, 0);
    const percent = quotaGB > 0 ? usedGB / quotaGB * 100 : 0;
    maxPercent = Math.max(maxPercent, percent);

    const flag = item.flag || "🌐";
    return [
      `${flag} ${item.name}  ${formatGB(usedGB)}/${formatGB(quotaGB)} ${percent.toFixed(1)}%`,
      `${formatGB(remainingGB)}  ${progressBar(percent, 10)}`,
      `剩余流量  ${resetDaysText(item.resetAt, now)}  更新${nowText(now)}`
    ].join("\n");
  });

  let style = "good";
  if (maxPercent >= 90) style = "error";
  else if (maxPercent >= 70) style = "alert";
  else if (maxPercent >= 50) style = "info";

  return { content: rows.join("\n\n"), style };
}

function renderPanel() {
  const services = loadServices();
  if (!services.length) {
    donePanel(
      "搬瓦工配置缺失",
      [
        "未读取到 BWG 私有配置。",
        "请使用 private/bwg-traffic-panel.sgmodule，直接把 VEID 和 API_KEY 写进私有模块。",
        "不要把真实 API_KEY 提交到公开仓库。"
      ].join("\n"),
      "error",
      "exclamationmark.triangle.fill"
    );
    return;
  }

  const now = new Date();
  const results = new Array(services.length);
  let pending = services.length;

  function finishOne(index, item) {
    results[index] = item;
    pending -= 1;
    if (pending > 0) return;

    const rendered = renderRows(results, now);
    donePanel(`搬瓦工流量｜更新 ${nowText(now)}`, rendered.content, rendered.style, "server.rack");
  }

  services.forEach((service, index) => {
    const configError = serviceError(service);
    if (configError) {
      finishOne(index, Object.assign({}, service, { error: configError }));
      return;
    }

    $httpClient.post({
      url: API_URL,
      timeout: service.timeout,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodedBody(service)
    }, (error, response, data) => {
      if (error) {
        finishOne(index, Object.assign({}, service, { error: `请求失败：${String(error)}` }));
        return;
      }

      const status = response ? response.status : "Unknown";
      if (!response || status < 200 || status >= 300) {
        finishOne(index, Object.assign({}, service, { error: `HTTP ${status}` }));
        return;
      }

      finishOne(index, parseTraffic(service, data));
    });
  });
}

renderPanel();
