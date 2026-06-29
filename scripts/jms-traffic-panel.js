// JMS Traffic Panel for Surge
// Reads the Just My Socks bandwidth counter API and renders it as a Surge Information Panel.
// The API URL should be passed via $argument. Do NOT hard-code your real API URL in a public repository.

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function decimalGB(bytes) {
  return bytes / 1000000000;
}

function formatGB(value) {
  if (!Number.isFinite(value)) return "未知";
  if (value >= 100) return `${value.toFixed(1)} GB`;
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

function getApiUrl() {
  const arg = String($argument || "").trim();
  if (!arg) return "";

  // Mode 1: argument is the raw JMS API URL.
  if (looksLikeUrl(arg)) return arg;

  // Mode 2: argument is URL-encoded as a whole.
  const decodedWhole = decodeMaybe(arg);
  if (looksLikeUrl(decodedWhole)) return decodedWhole;

  // Mode 3: argument is explicitly keyed by the module:
  // jms_api_url=<raw-or-encoded-url>, JMS_API_URL=<...>, or API_URL=<...>
  // Important: take everything after the first '=' so raw URLs with '&' are preserved.
  const prefixes = ["jms_api_url=", "JMS_API_URL=", "API_URL="];
  for (const prefix of prefixes) {
    if (arg.indexOf(prefix) === 0) {
      const value = decodeMaybe(arg.slice(prefix.length));
      if (looksLikeUrl(value)) return value;
    }
  }

  // Mode 4: fallback parser for simple query-string arguments.
  const parsed = parseQueryLikeArgument(arg);
  const url = parsed.jms_api_url || parsed.JMS_API_URL || parsed.API_URL || "";
  if (looksLikeUrl(url)) return url;

  return "";
}

function shortArgForDebug() {
  const arg = String($argument || "").trim();
  if (!arg) return "空";
  if (arg.indexOf("%JMS_API_URL%") !== -1 || arg.indexOf("%jms_api_url%") !== -1) return "模块参数占位符未被替换";
  if (arg.length <= 80) return arg;
  return `${arg.slice(0, 32)}...${arg.slice(-16)}，长度 ${arg.length}`;
}

function donePanel(title, content, style, icon) {
  const payload = { title, content };
  if (style) payload.style = style;
  if (icon) payload.icon = icon;
  $done(payload);
}

const API_URL = getApiUrl();

if (!API_URL) {
  donePanel(
    "JMS 流量",
    [
      "未读取到 JMS API URL。",
      "请确认模块参数 jms_api_url 已填写；如果刚更新模块，请删除旧模块后重新安装。",
      `当前参数：${shortArgForDebug()}`,
      `更新：${nowText()}`
    ].join("\n"),
    "error",
    "exclamationmark.triangle.fill"
  );
} else {
  $httpClient.get(
    {
      url: API_URL,
      timeout: 10,
      "auto-redirect": true
    },
    function (error, response, data) {
      if (error) {
        donePanel(
          "JMS 流量查询失败",
          `请求失败：${String(error)}\n更新：${nowText()}`,
          "error",
          "wifi.exclamationmark"
        );
        return;
      }

      const status = response ? response.status : "Unknown";
      if (!response || status < 200 || status >= 300) {
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
