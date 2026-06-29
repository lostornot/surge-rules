const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "jms-traffic-panel.js");
const modulePath = path.join(__dirname, "..", "modules", "jms-traffic-panel.sgmodule");
const source = fs.readFileSync(scriptPath, "utf8");

function runPanel({
  argument = "",
  storedUrl = "",
  response = { status: 200 },
  data = JSON.stringify({
    monthly_bw_limit_b: 500000000000,
    bw_counter_b: 68157547558,
    bw_reset_day_of_month: 16
  }),
  error = null
} = {}) {
  let donePayload;
  let requestedUrl;

  const sandbox = {
    console,
    $argument: argument,
    $persistentStore: {
      read(key) {
        assert.strictEqual(key, "jms_traffic_panel_api_url");
        return storedUrl;
      },
      write() {
        return true;
      }
    },
    $httpClient: {
      get(options, callback) {
        requestedUrl = options.url;
        callback(error, response, data);
      }
    },
    $done(payload) {
      donePayload = payload;
    }
  };

  vm.runInNewContext(source, sandbox, { filename: scriptPath });
  return { donePayload, requestedUrl };
}

function runSetup({ requestUrl, storedUrl = "" }) {
  let donePayload;
  let written;

  const sandbox = {
    console,
    $request: { url: requestUrl },
    $persistentStore: {
      read(key) {
        assert.strictEqual(key, "jms_traffic_panel_api_url");
        return storedUrl;
      },
      write(value, key) {
        assert.strictEqual(key, "jms_traffic_panel_api_url");
        written = value;
        return true;
      }
    },
    $done(payload) {
      donePayload = payload;
    }
  };

  vm.runInNewContext(source, sandbox, { filename: scriptPath });
  return { donePayload, written };
}

test("uses JMS_API_URL module argument to fetch and render traffic", () => {
  const apiUrl = "https://justmysocks.example/members/getbwcounter.php?service=1&id=abc";
  const { donePayload, requestedUrl } = runPanel({
    argument: `JMS_API_URL=${encodeURIComponent(apiUrl)}`
  });

  assert.strictEqual(requestedUrl, apiUrl);
  assert.match(donePayload.title, /JMS 流量/);
  assert.match(donePayload.title, /剩余 431\.84 GB/);
  assert.match(donePayload.content, /已用：68\.16 GB \/ 500\.00 GB（13\.6%）/);
  assert.match(donePayload.content, /重置：每月 16 日/);
  assert.strictEqual(donePayload.style, "good");
});

test("supports lowercase url argument", () => {
  const apiUrl = "https://example.com/api?service=1&id=abc";
  const { requestedUrl } = runPanel({
    argument: `url=${encodeURIComponent(apiUrl)}`
  });

  assert.strictEqual(requestedUrl, apiUrl);
});

test("keeps unencoded ampersands inside module API URL", () => {
  const apiUrl = "https://justmysocks.example/members/getbwcounter.php?service=1397602&id=f488";
  const { requestedUrl } = runPanel({
    argument: `JMS_API_URL=${apiUrl}`
  });

  assert.strictEqual(requestedUrl, apiUrl);
});

test("builds API URL from separate service and id arguments", () => {
  const { requestedUrl } = runPanel({
    argument: "JMS_SERVICE=1397602&JMS_ID=f488c8e5-d546-4145-b407-9e3c2ee89281"
  });

  assert.strictEqual(
    requestedUrl,
    "https://justmysocks6.net/members/getbwcounter.php?service=1397602&id=f488c8e5-d546-4145-b407-9e3c2ee89281"
  );
});

test("falls back to locally saved URL when module argument placeholder is not replaced", () => {
  const apiUrl = "https://justmysocks.example/members/getbwcounter.php?service=1397602&id=f488";
  const { requestedUrl, donePayload } = runPanel({
    argument: "JMS_API_URL=%JMS_API_URL%",
    storedUrl: apiUrl
  });

  assert.strictEqual(requestedUrl, apiUrl);
  assert.match(donePayload.title, /JMS 流量/);
});

test("setup request saves API URL to persistent store", () => {
  const apiUrl = "https://justmysocks.example/members/getbwcounter.php?service=1397602&id=f488";
  const { donePayload, written } = runSetup({
    requestUrl: `http://jms-panel.test/set?url=${apiUrl}`
  });

  assert.strictEqual(written, apiUrl);
  assert.strictEqual(donePayload.response.status, 200);
  assert.match(donePayload.response.body, /保存成功/);
});

test("returns clear panel error when API URL is missing", () => {
  const { donePayload, requestedUrl } = runPanel({ argument: "" });

  assert.strictEqual(requestedUrl, undefined);
  assert.strictEqual(donePayload.title, "JMS 流量配置缺失");
  assert.match(donePayload.content, /JMS_API_URL/);
  assert.strictEqual(donePayload.style, "error");
});

test("returns clear panel error when response is not JSON", () => {
  const { donePayload } = runPanel({
    argument: "JMS_API_URL=https%3A%2F%2Fexample.com%2Fapi",
    data: "<html>nope</html>"
  });

  assert.strictEqual(donePayload.title, "JMS 流量查询失败");
  assert.match(donePayload.content, /返回内容不是 JSON/);
  assert.strictEqual(donePayload.style, "error");
});

test("returns clear panel error when traffic fields are missing", () => {
  const { donePayload } = runPanel({
    argument: "JMS_API_URL=https%3A%2F%2Fexample.com%2Fapi",
    data: JSON.stringify({ ok: true })
  });

  assert.strictEqual(donePayload.title, "JMS 流量查询失败");
  assert.match(donePayload.content, /缺少流量字段/);
  assert.strictEqual(donePayload.style, "error");
});

test("module declares JMS_API_URL argument and exposes setup fallback endpoint", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");

  assert.match(moduleSource, /^#!arguments=JMS_API_URL=/m);
  assert.match(moduleSource, /\[Host\]\njms-panel\.test = 198\.18\.0\.1/);
  assert.match(moduleSource, /argument="JMS_API_URL=%JMS_API_URL%"/);
  assert.match(moduleSource, /jms-panel\\\.test/);
  assert.match(moduleSource, /type=http-request/);
});
