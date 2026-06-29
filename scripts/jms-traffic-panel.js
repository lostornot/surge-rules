// JMS Traffic Panel for Surge
// Reads the Just My Socks bandwidth counter API and renders it as a Surge Information Panel.
// Configure it with the module argument JMS_API_URL. Do NOT hard-code your real API URL in a public repository.

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

  arg.split("&").forEach(pair => {
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
  return extractApiUrlFromString($argument);
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

function renderPanel() {
  const argumentUrl = getApiUrlFromArgument();
  const storeUrl = getApiUrlFromStore();
  const API_URL = argumentUrl || storeUrl;

  if (!API_URL) {
    donePanel(
      "JMS 流量配置缺失",
      [
        "未读取到 JMS API URL。",
        "请在模块参数 JMS_API_URL 中填写 Just My Socks Bandwidth Counter API 链接。",
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
  donePanel("JMS 流量", "此脚本仅用于 Surge 信息面板。", "info", "gauge.with.dots.needle.33percent");
} else {
  renderPanel();
}
