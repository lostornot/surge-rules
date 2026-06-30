const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const legacyScriptPath = path.join(__dirname, "..", "scripts", "vps-traffic-panel.js");
const scriptPath = path.join(__dirname, "..", "scripts", "vps-traffic-panel-v2.js");
const modulePath = path.join(__dirname, "..", "modules", "vps-traffic-panel.sgmodule");
const moduleV3Path = path.join(__dirname, "..", "modules", "vps-traffic-panel-v3.sgmodule");

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function runPanel({ config, responses, now = "2026-06-30T11:11:00+08:00" }) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const requestedUrls = [];
  let donePayload;

  const sandbox = {
    console,
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
      static now() {
        return new Date(now).getTime();
      }
    },
    $argument: `VPS_CONFIG_B64=${base64UrlJson(config)}`,
    $httpClient: {
      get(options, callback) {
        const url = typeof options === "string" ? options : options.url;
        requestedUrls.push(url);
        const item = responses[url];
        if (!item) {
          callback("not found", { status: 404 }, "");
          return;
        }
        callback(item.error || null, { status: item.status || 200 }, item.body);
      }
    },
    $done(payload) {
      donePayload = payload;
    }
  };

  vm.runInNewContext(source, sandbox, { filename: scriptPath });
  return { donePayload, requestedUrls };
}

function runPanelWithArgument({ argument, responses, now = "2026-06-30T11:11:00+08:00" }) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const requestedUrls = [];
  let donePayload;

  const sandbox = {
    console,
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
      static now() {
        return new Date(now).getTime();
      }
    },
    $argument: argument,
    $httpClient: {
      get(options, callback) {
        const url = typeof options === "string" ? options : options.url;
        requestedUrls.push(url);
        const item = responses[url];
        if (!item) {
          callback("not found", { status: 404 }, "");
          return;
        }
        callback(item.error || null, { status: item.status || 200 }, item.body);
      }
    },
    $done(payload) {
      donePayload = payload;
    }
  };

  vm.runInNewContext(source, sandbox, { filename: scriptPath });
  return { donePayload, requestedUrls };
}

test("renders multiple VPS traffic rows with reset countdown and dot progress", () => {
  const config = {
    vps: [
      {
        name: "JMS S5 NL",
        url: "https://vps1.example/traffic",
        limit_gb: 500,
        reset: { type: "monthly", day: 16 }
      },
      {
        name: "BWG DC6",
        url: "https://vps2.example/traffic",
        limit_gb: 1000,
        reset: { type: "rolling", start: "2026-06-11", days: 30 }
      }
    ]
  };

  const { donePayload, requestedUrls } = runPanel({
    config,
    responses: {
      "https://vps1.example/traffic": {
        body: JSON.stringify({
          country: "US",
          rx_bytes: 40000000000,
          tx_bytes: 48300000000
        })
      },
      "https://vps2.example/traffic?period_start=2026-06-11&period_days=30": {
        body: JSON.stringify({
          flag: "⚠️",
          rx_bytes: 500000000000,
          tx_bytes: 211600000000
        })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "https://vps1.example/traffic",
    "https://vps2.example/traffic?period_start=2026-06-11&period_days=30"
  ]);
  assert.strictEqual(donePayload.title, "VPS 流量总览｜更新 11:11");
  assert.match(donePayload.content, /🇺🇸 JMS S5 NL 剩余411\.70G 16天后重置/);
  assert.match(donePayload.content, /88\.3\/500G  17\.7%  ●●○○○○○○○○/);
  assert.match(donePayload.content, /⚠️ BWG DC6 剩余288\.40G 11天后重置/);
  assert.match(donePayload.content, /711\.6\/1000G  71\.2%  ●●●●●●●○○○/);
  assert.strictEqual(donePayload.style, "alert");
});

test("returns configuration error when no VPS argument is present", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  let donePayload;

  vm.runInNewContext(source, {
    console,
    $argument: "",
    $done(payload) {
      donePayload = payload;
    }
  }, { filename: scriptPath });

  assert.strictEqual(donePayload.title, "VPS 流量配置缺失");
  assert.match(donePayload.content, /US-1446,100\.79\.53\.68/);
  assert.match(donePayload.content, /当前参数：空/);
  assert.strictEqual(donePayload.style, "error");
});

test("renders VPS rows from one simple VPS argument", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: "VPS=US-1446,100.79.53.68",
    responses: {
      "http://100.79.53.68:8787/traffic": {
        body: JSON.stringify({
          country: "US",
          rx_bytes: 40000000000,
          tx_bytes: 48300000000,
          limit_gb: 500,
          reset: { type: "monthly", day: 6 }
        })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "http://100.79.53.68:8787/traffic"
  ]);
  assert.match(donePayload.content, /🇺🇸 US-1446 剩余411\.70G 6天后重置/);
});

test("renders VPS rows when Surge passes the raw single argument value", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: "US-1446,100.79.53.68",
    responses: {
      "http://100.79.53.68:8787/traffic": {
        body: JSON.stringify({
          country: "US",
          rx_bytes: 40000000000,
          tx_bytes: 48300000000,
          limit_gb: 500,
          reset: { type: "monthly", day: 6 }
        })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "http://100.79.53.68:8787/traffic"
  ]);
  assert.match(donePayload.content, /🇺🇸 US-1446 剩余411\.70G/);
});

test("renders VPS rows when raw argument is URL encoded", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: "US-1446%2C100.79.53.68",
    responses: {
      "http://100.79.53.68:8787/traffic": {
        body: JSON.stringify({
          country: "US",
          rx_bytes: 40000000000,
          tx_bytes: 48300000000,
          limit_gb: 500,
          reset: { type: "monthly", day: 6 }
        })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "http://100.79.53.68:8787/traffic"
  ]);
  assert.match(donePayload.content, /🇺🇸 US-1446 剩余411\.70G/);
});

test("renders VPS rows with Chinese comma separator", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: "US-1446，100.79.53.68",
    responses: {
      "http://100.79.53.68:8787/traffic": {
        body: JSON.stringify({
          country: "US",
          rx_bytes: 40000000000,
          tx_bytes: 48300000000,
          limit_gb: 500,
          reset: { type: "monthly", day: 6 }
        })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "http://100.79.53.68:8787/traffic"
  ]);
  assert.match(donePayload.content, /🇺🇸 US-1446 剩余411\.70G/);
});

test("renders multiple VPS rows from pipe-separated simple VPS argument", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: "VPS=US-1446,100.79.53.68|BWG DC6,bwg-dc6.tailnet.ts.net",
    responses: {
      "http://100.79.53.68:8787/traffic": {
        body: JSON.stringify({ country: "US", rx_bytes: 1, tx_bytes: 2, limit_gb: 500, reset: { type: "monthly", day: 1 } })
      },
      "http://bwg-dc6.tailnet.ts.net:8787/traffic": {
        body: JSON.stringify({ country: "US", rx_bytes: 3, tx_bytes: 4, limit_gb: 1000, reset: { type: "monthly", day: 1 } })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "http://100.79.53.68:8787/traffic",
    "http://bwg-dc6.tailnet.ts.net:8787/traffic"
  ]);
  assert.match(donePayload.content, /US-1446/);
  assert.match(donePayload.content, /BWG DC6/);
});

test("renders simple server-side configured VPS rows without token", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: [
      "VPS1_NAME=US-1446",
      "VPS1_HOST=us-1446.tailnet.ts.net",
      "VPS1_PORT=8787"
    ].join(";"),
    responses: {
      "http://us-1446.tailnet.ts.net:8787/traffic": {
        body: JSON.stringify({
          country: "US",
          rx_bytes: 40000000000,
          tx_bytes: 48300000000,
          limit_gb: 500,
          reset: { type: "monthly", day: 6 }
        })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "http://us-1446.tailnet.ts.net:8787/traffic"
  ]);
  assert.match(donePayload.content, /🇺🇸 US-1446 剩余411\.70G 6天后重置/);
  assert.match(donePayload.content, /88\.3\/500G  17\.7%  ●●○○○○○○○○/);
});

test("renders VPS rows from readable indexed arguments", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: [
      "VPS1_NAME=US-1446",
      "VPS1_URL=https%3A%2F%2Fvps1.example%2Ftraffic%3Ftoken%3Dabc",
      "VPS1_LIMIT_GB=500",
      "VPS1_RESET_TYPE=monthly",
      "VPS1_RESET_DAY=1",
      "VPS2_NAME=BWG DC6",
      "VPS2_URL=https%3A%2F%2Fvps2.example%2Ftraffic%3Ftoken%3Ddef",
      "VPS2_LIMIT_GB=1000",
      "VPS2_RESET_TYPE=rolling",
      "VPS2_RESET_START=2026-06-11",
      "VPS2_RESET_DAYS=30"
    ].join(";"),
    responses: {
      "https://vps1.example/traffic?token=abc": {
        body: JSON.stringify({ country: "US", rx_bytes: 40000000000, tx_bytes: 48300000000 })
      },
      "https://vps2.example/traffic?token=def&period_start=2026-06-11&period_days=30": {
        body: JSON.stringify({ flag: "⚠️", rx_bytes: 500000000000, tx_bytes: 211600000000 })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "https://vps1.example/traffic?token=abc",
    "https://vps2.example/traffic?token=def&period_start=2026-06-11&period_days=30"
  ]);
  assert.match(donePayload.content, /🇺🇸 US-1446 剩余411\.70G/);
  assert.match(donePayload.content, /⚠️ BWG DC6 剩余288\.40G/);
});

test("renders VPS rows from simple host arguments", () => {
  const { donePayload, requestedUrls } = runPanelWithArgument({
    argument: [
      "VPS1_NAME=US-1446",
      "VPS1_HOST=100.79.53.68",
      "VPS1_PORT=8787",
      "VPS1_TOKEN=abc",
      "VPS1_LIMIT_GB=500",
      "VPS1_RESET_TYPE=monthly",
      "VPS1_RESET_DAY=1"
    ].join(";"),
    responses: {
      "http://100.79.53.68:8787/traffic?token=abc": {
        body: JSON.stringify({ country: "US", rx_bytes: 40000000000, tx_bytes: 48300000000 })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "http://100.79.53.68:8787/traffic?token=abc"
  ]);
  assert.match(donePayload.content, /🇺🇸 US-1446 剩余411\.70G/);
});

test("simple host arguments omit default port for https", () => {
  const { requestedUrls } = runPanelWithArgument({
    argument: [
      "VPS1_NAME=BWG DC6",
      "VPS1_HOST=bwg-dc6.example.com",
      "VPS1_HTTPS=1",
      "VPS1_TOKEN=def",
      "VPS1_LIMIT_GB=1000",
      "VPS1_RESET_TYPE=monthly",
      "VPS1_RESET_DAY=1"
    ].join(";"),
    responses: {
      "https://bwg-dc6.example.com/traffic?token=def": {
        body: JSON.stringify({ country: "US", rx_bytes: 1, tx_bytes: 2 })
      }
    }
  });

  assert.deepStrictEqual(requestedUrls, [
    "https://bwg-dc6.example.com/traffic?token=def"
  ]);
});

test("module declares simple VPS host arguments", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");

  assert.match(moduleSource, /^#!arguments=VPS=US-1446%2C100\.79\.53\.68$/m);
  assert.match(moduleSource, /script-name=vps-traffic-panel-v2/);
  assert.match(moduleSource, /argument="VPS=%VPS%"/);
  assert.match(moduleSource, /scripts\/vps-traffic-panel-v2\.js/);
  assert.ok(fs.existsSync(scriptPath));
  assert.ok(fs.existsSync(legacyScriptPath));
});

test("v3 module uses raw VPS argument and a dedicated script", () => {
  const moduleSource = fs.readFileSync(moduleV3Path, "utf8");

  assert.match(moduleSource, /^#!name=VPS 流量面板 V3$/m);
  assert.match(moduleSource, /^#!arguments=VPS=US-1446%2C100\.79\.53\.68$/m);
  assert.match(moduleSource, /script-name=vps-traffic-panel-v3/);
  assert.match(moduleSource, /argument="%VPS%"/);
  assert.match(moduleSource, /scripts\/vps-traffic-panel-v3\.js/);
});
