// JMS Traffic Panel for Surge
// Reads the Just My Socks bandwidth counter API and renders it as a Surge Information Panel.
// Configure it with the module argument JMS_API_URL, or save the URL locally via the setup endpoint.
// Do NOT hard-code your real API URL in a public repository.

const STORE_KEY = "jms_traffic_panel_api_url";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function decimalGB(bytes) {
  return bytes / 1000000000;
}

function formatGB(value) {
  if (!Number.isFinite(value)) return "未知";
  return `${value.toFixed(2)} GB`;
}

function nowText() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function parseQueryLikeArgument(arg) {
  const result = {};
  if (!arg || arg.indexOf("=") === -1) return result;

  arg.split(/[&;\n]/).forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    result[key] = decodeMaybe(value);
  });

  return result;
}

function extractApiUrlFromString(input) {
  const arg = String(input || "").trim();
  if (!arg) return "";

  if (looksLikeUrl(arg)) return arg;

  const decodedWhole = decodeMaybe(arg);
  if (looksLikeUrl(decodedWhole)) return decodedWhole;

  const prefixes = ["jms_api_url=", "JMS_API_URL=", "API_URL=", "url=", "api="];
  for (const prefix of prefixes) {
    if (arg.indexOf(prefix) === 0) {
      const value = decodeMaybe(arg.slice(prefix.length));
      if (looksLikeUrl(value)) return value;
    }
  }

  const parsed = parseQueryLikeArgument(arg);
  const url = parsed.jms_api_url || parsed.JMS_API_URL || parsed.API_URL || parsed.url || parsed.api || "";
  if (looksLikeUrl(url)) return url;

  return "";
}

function getApiUrlFromArgument() {
  if (typeof $argument === "undefined") return "";
  const url = extractApiUrlFromString($argument);
  if (url) return url;

  const parsed = parseQueryLikeArgument(String($argument || ""));
  const service = parsed.JMS_SERVICE || parsed.jms_service || parsed.service || "";
  const id = parsed.JMS_ID || parsed.jms_id || parsed.id || "";
  if (service && id) {
    return `https://justmysocks6.net/members/getbwcounter.php?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`;
  }

  return "";
}

function getApiUrlFromStore() {
  try {
    if (typeof $persistentStore === "undefined") return "";
    const value = $persistentStore.read(STORE_KEY);
    return extractApiUrlFromString(value);
  } catch (_) {
    return "";
  }
}

function saveApiUrl(url) {
  try {
    if (typeof $persistentStore === "undefined") return false;
    return $persistentStore.write(url, STORE_KEY);
  } catch (_) {
    return false;
  }
}

function clearApiUrl() {
  try {
    if (typeof $persistentStore === "undefined") return false;
    return $persistentStore.write("", STORE_KEY);
  } catch (_) {
    return false;
  }
}

function maskUrl(url) {
  const s = String(url || "");
  if (!s) return "未设置";
  if (s.length <= 40) return s;
  return `${s.slice(0, 30)}...${s.slice(-12)}`;
}

function shortArgForDebug() {
  const arg = typeof $argument === "undefined" ? "" : String($argument || "").trim();
  if (!arg) return "空";
  if (
    arg.indexOf("%JMS_API_URL%") !== -1 ||
    arg.indexOf("%jms_api_url%") !== -1 ||
    arg.indexOf("{{{JMS_API_URL}}}") !== -1
  ) {
    return "模块参数占位符未被替换";
  }
  if (arg.length <= 80) return arg;
  return `${arg.slice(0, 32)}...${arg.slice(-16)}，长度 ${arg.length}`;
}

function donePanel(title, content, style, icon) {
  const payload = { title, content };
  if (style) payload.style = style;
  if (icon) payload.icon = icon;
  $done(payload);
}

function response(status, body) {
  $done({
    response: {
      status: status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: body
    }
  });
}

function html(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;line-height:1.55}code{word-break:break-all;background:#f3f3f3;padding:2px 4px;border-radius:4px}.ok{color:#16833a}.bad{color:#b00020}</style></head><body>${body}</body></html>`;
}

function handleSetupRequest() {
  const url = String($request.url || "");

  if (/^http:\/\/jms-panel\.test\/clear/i.test(url)) {
    const ok = clearApiUrl();
    response(200, html("JMS 流量面板", `<h2 class="${ok ? "ok" : "bad"}">${ok ? "已清除" : "清除失败"}</h2><p>现在可以重新保存 API URL。</p>`));
    return;
  }

  if (/^http:\/\/jms-panel\.test\/show/i.test(url)) {
    const saved = getApiUrlFromStore();
    response(200, html("JMS 流量面板", `<h2>当前状态</h2><p>${saved ? "已保存 API URL" : "未保存 API URL"}</p><p><code>${maskUrl(saved)}</code></p>`));
    return;
  }

  const marker = "/set?";
  const idx = url.indexOf(marker);
  const raw = idx >= 0 ? url.slice(idx + marker.length) : "";
  const apiUrl = extractApiUrlFromString(raw);

  if (!apiUrl) {
    response(400, html("JMS 流量面板", `<h2 class="bad">没有识别到 API URL</h2><p>请使用：</p><p><code>http://jms-panel.test/set?url=你的JMS API链接</code></p>`));
    return;
  }

  const ok = saveApiUrl(apiUrl);
  response(200, html("JMS 流量面板", `<h2 class="${ok ? "ok" : "bad"}">${ok ? "保存成功" : "保存失败"}</h2><p>JMS API URL 已保存到 Surge 本地存储。</p><p><code>${maskUrl(apiUrl)}</code></p><p>回到 Surge 的策略选择页面，刷新「JMS流量」面板即可。</p>`));
}

function renderPanel() {
  const argumentUrl = getApiUrlFromArgument();
  const storeUrl = getApiUrlFromStore();
  const API_URL = argumentUrl || storeUrl;

  if (!API_URL) {
    donePanel(
      "JMS 流量配置缺失",
      [
        "未读取到 JMS API URL。",
        "请先尝试填写模块参数 JMS_API_URL。",
        "如果显示占位符未替换，请用 Safari 打开：",
        "http://jms-panel.test/set?url=你的JMS API链接",
        `当前参数：${shortArgForDebug()}`,
        `更新：${nowText()}`
      ].join("\n"),
      "error",
      "exclamationmark.triangle.fill"
    );
    return;
  }

  $httpClient.get(
    {
      url: API_URL,
      timeout: 10,
      "auto-redirect": true
    },
    function (error, responseObj, data) {
      if (error) {
        donePanel(
          "JMS 流量查询失败",
          `请求失败：${String(error)}\n更新：${nowText()}`,
          "error",
          "wifi.exclamationmark"
        );
        return;
      }

      const status = responseObj ? responseObj.status : "Unknown";
      if (!responseObj || status < 200 || status >= 300) {
        donePanel(
          "JMS 流量查询失败",
          `HTTP ${status}\n${data ? String(data).slice(0, 160) : "无返回内容"}\n更新：${nowText()}`,
          "error",
          "xmark.octagon.fill"
        );
        return;
      }

      let json;
      try {
        json = JSON.parse(data);
      } catch (_) {
        donePanel(
          "JMS 流量查询失败",
          `返回内容不是 JSON\n${data ? String(data).slice(0, 160) : "空响应"}\n更新：${nowText()}`,
          "error",
          "curlybraces"
        );
        return;
      }

      const totalBytes = toNumber(json.monthly_bw_limit_b);
      const usedBytes = toNumber(json.bw_counter_b);
      const resetDay = json.bw_reset_day_of_month || "未知";

      if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(usedBytes)) {
        donePanel(
          "JMS 流量查询失败",
          `缺少流量字段\n${JSON.stringify(json).slice(0, 180)}\n更新：${nowText()}`,
          "error",
          "questionmark.app.fill"
        );
        return;
      }

      const totalGB = decimalGB(totalBytes);
      const usedGB = decimalGB(usedBytes);
      const leftGB = Math.max(totalGB - usedGB, 0);
      const percent = usedGB / totalGB * 100;

      let style = "good";
      let icon = "gauge.with.dots.needle.33percent";
      if (percent >= 90) {
        style = "error";
        icon = "gauge.with.dots.needle.100percent";
      } else if (percent >= 80) {
        style = "alert";
        icon = "gauge.with.dots.needle.67percent";
      } else if (percent >= 60) {
        style = "info";
        icon = "gauge.with.dots.needle.50percent";
      }

      const title = `JMS 流量｜剩余 ${formatGB(leftGB)}`;
      const content = [
        `已用：${formatGB(usedGB)} / ${formatGB(totalGB)}（${percent.toFixed(1)}%）`,
        `剩余：${formatGB(leftGB)}`,
        `重置：每月 ${resetDay} 日`,
        `更新：${nowText()}`
      ].join("\n");

      donePanel(title, content, style, icon);
    }
  );
}

if (typeof $request !== "undefined") {
  handleSetupRequest();
} else {
  renderPanel();
}
