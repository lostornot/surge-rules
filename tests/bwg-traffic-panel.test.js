const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "bwg-traffic-panel.js");
const exampleModulePath = path.join(__dirname, "..", "modules", "bwg-traffic-panel.example.sgmodule");

function runPanel({ argument, responses, now = "2026-06-30T11:11:00+08:00" }) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const requests = [];
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
      post(options, callback) {
        requests.push(options);
        const item = responses[options.body];
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
  return { donePayload, requests };
}

test("renders one KiwiVM service with remaining traffic in the title", () => {
  const { donePayload, requests } = runPanel({
    argument: [
      "BWG1_NAME=🇺🇸BWG-US-DC6",
      "BWG1_VEID=123456",
      "BWG1_API_KEY=secret"
    ].join(";"),
    responses: {
      "veid=123456&api_key=secret": {
        body: JSON.stringify({
          error: 0,
          plan_monthly_data: 322122547200,
          data_counter: 569810827,
          monthly_data_multiplier: 1,
          data_next_reset: 1783569600
        })
      }
    }
  });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, "https://api.64clouds.com/v1/getServiceInfo");
  assert.strictEqual(requests[0].body, "veid=123456&api_key=secret");
  assert.strictEqual(donePayload.title, "🇺🇸BWG-US-DC6｜剩余流量 321.55 GB");
  assert.match(donePayload.content, /^已用 0\.57 \/ 322\.12 GB（0\.2%）$/m);
  assert.match(donePayload.content, /^□□□□□□□□□□ 0\.2%$/m);
  assert.match(donePayload.content, /^重置：还剩10天$/m);
  assert.match(donePayload.content, /^更新：11:11$/m);
  assert.strictEqual(donePayload.style, "good");
});

test("applies monthly_data_multiplier to used traffic and quota", () => {
  const { donePayload } = runPanel({
    argument: "BWG1_NAME=倍率机;BWG1_VEID=7;BWG1_API_KEY=k",
    responses: {
      "veid=7&api_key=k": {
        body: JSON.stringify({
          error: 0,
          plan_monthly_data: 100000000000,
          data_counter: 40000000000,
          monthly_data_multiplier: 2,
          data_next_reset: 1783569600
        })
      }
    }
  });

  assert.match(donePayload.title, /剩余流量 120\.00 GB/);
  assert.match(donePayload.content, /已用 80\.00 \/ 200\.00 GB（40\.0%）/);
  assert.match(donePayload.content, /■■■■□□□□□□ 40\.0%/);
});

test("renders multiple services and escalates style by highest usage", () => {
  const { donePayload } = runPanel({
    argument: [
      "BWG1_NAME=DC6;BWG1_VEID=1;BWG1_API_KEY=a",
      "BWG2_NAME=HK;BWG2_FLAG=🇭🇰;BWG2_VEID=2;BWG2_API_KEY=b"
    ].join(";"),
    responses: {
      "veid=1&api_key=a": {
        body: JSON.stringify({
          error: 0,
          plan_monthly_data: 100000000000,
          data_counter: 25000000000,
          monthly_data_multiplier: 1,
          data_next_reset: 1783569600
        })
      },
      "veid=2&api_key=b": {
        body: JSON.stringify({
          error: 0,
          plan_monthly_data: 100000000000,
          data_counter: 91000000000,
          monthly_data_multiplier: 1,
          data_next_reset: 1783569600
        })
      }
    }
  });

  assert.match(donePayload.content, /已用 25\.00 \/ 100\.00 GB（25\.0%）/);
  assert.match(donePayload.content, /已用 91\.00 \/ 100\.00 GB（91\.0%）/);
  assert.strictEqual(donePayload.style, "error");
});

test("returns a clear configuration error without private credentials", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  let donePayload;

  vm.runInNewContext(source, {
    console,
    $argument: "",
    $done(payload) {
      donePayload = payload;
    }
  }, { filename: scriptPath });

  assert.strictEqual(donePayload.title, "搬瓦工配置缺失");
  assert.match(donePayload.content, /请使用 private\/bwg-traffic-panel\.sgmodule/);
  assert.strictEqual(donePayload.style, "error");
});

test("example module documents private hardcoded arguments without Surge placeholders", () => {
  const moduleSource = fs.readFileSync(exampleModulePath, "utf8");

  assert.doesNotMatch(moduleSource, /^#!arguments=/m);
  assert.match(moduleSource, /script-name=bwg-traffic-panel/);
  assert.match(moduleSource, /BWG1_VEID=123456/);
  assert.match(moduleSource, /BWG1_API_KEY=CHANGE_ME/);
  assert.match(moduleSource, /scripts\/bwg-traffic-panel\.js/);
});
