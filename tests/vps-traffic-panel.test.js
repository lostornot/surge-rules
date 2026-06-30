const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "vps-traffic-panel.js");
const modulePath = path.join(__dirname, "..", "modules", "vps-traffic-panel.sgmodule");

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

test("returns configuration error when VPS_CONFIG_B64 is missing", () => {
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
  assert.match(donePayload.content, /VPS_CONFIG_B64/);
  assert.strictEqual(donePayload.style, "error");
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

test("module declares VPS_CONFIG_B64 argument", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");

  assert.match(moduleSource, /^#!arguments=VPS_CONFIG_B64=/m);
  assert.match(moduleSource, /script-name=vps-traffic-panel/);
  assert.match(moduleSource, /argument="VPS_CONFIG_B64=%VPS_CONFIG_B64%"/);
});
