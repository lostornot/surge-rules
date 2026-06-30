# surge-rules

个人 Surge 规则、模块和脚本。

## JMS 流量面板

用途：在 Surge 的信息面板里显示 Just My Socks 当前周期流量，不主动发通知。

### 文件

- `modules/jms-traffic-panel.sgmodule`
- `scripts/jms-traffic-panel.js`

### 安装

Surge 中添加模块 URL：

```text
https://raw.githubusercontent.com/lostornot/surge-rules/main/modules/jms-traffic-panel.sgmodule
```

启用模块时，在模块参数 `JMS_API_URL` 中填写 Just My Socks 后台的 **Bandwidth Counter API** 链接。

> 注意：JMS API URL 相当于只读密钥，不要把真实链接提交到 GitHub，不要分享给别人。

如果面板显示“模块参数占位符未被替换”，说明当前 Surge 没有把模块参数传给脚本。可以用 Safari 打开下面的本地设置链接，把 API URL 保存到 Surge 本地存储：

```text
http://jms-panel.test/set?url=你的JMS API链接
```

保存成功后回到 Surge，刷新「JMS流量」面板即可。

### 显示内容

- 已用流量
- 总流量
- 剩余流量
- 使用率
- 每月重置日
- 最后更新时间

### 说明

`update-interval=3600` 表示 Surge 进入策略选择页面时，最多每 3600 秒自动刷新一次；也可以手动点刷新。

## VPS 流量面板

用途：在 Surge 信息面板里显示多台 VPS 的双向流量总览。

### 文件

- `modules/vps-traffic-panel.sgmodule`
- `scripts/vps-traffic-panel.js`

### VPS API 返回格式

每台 VPS 暴露一个 JSON API，返回上传和下载字节数：

```json
{
  "rx_bytes": 40000000000,
  "tx_bytes": 48300000000,
  "country": "US",
  "updated_at": "2026-06-30T11:11:00+08:00"
}
```

`country` 可选；如果返回 `flag`，面板会优先使用 `flag`。

仓库提供了一个可选 VPS 端 agent：

- `vps-agent/vps_traffic_api.py`
- `vps-agent/README.md`

它基于 `vnStat` 输出当前自然月上传/下载字节数。

### Surge 配置格式

推荐在私有本地模块里直接使用可读参数：

```text
VPS1_NAME=US-1446;
VPS1_URL=https%3A%2F%2Fus-1446.example.com%2Ftraffic%3Ftoken%3DCHANGE_ME;
VPS1_LIMIT_GB=500;
VPS1_RESET_TYPE=monthly;
VPS1_RESET_DAY=1;
VPS2_NAME=BWG DC6;
VPS2_URL=https%3A%2F%2Fbwg-dc6.example.com%2Ftraffic%3Ftoken%3DCHANGE_ME;
VPS2_LIMIT_GB=1000;
VPS2_RESET_TYPE=rolling;
VPS2_RESET_START=2026-06-11;
VPS2_RESET_DAYS=30
```

URL 建议做百分号编码，避免 `?` 和 `&` 被 Surge 参数解析误伤。脚本会自动解码。

也兼容把配置 JSON 转成 base64url 后，填入 `VPS_CONFIG_B64`。配置示例：

```json
{
  "vps": [
    {
      "name": "JMS S5 NL",
      "url": "https://vps1.example.com/traffic",
      "limit_gb": 500,
      "reset": { "type": "monthly", "day": 16 }
    },
    {
      "name": "BWG DC6",
      "url": "https://vps2.example.com/traffic",
      "limit_gb": 1000,
      "reset": { "type": "rolling", "start": "2026-06-11", "days": 30 }
    }
  ]
}
```

显示示例：

```text
VPS 流量总览｜更新 11:11

🇺🇸 JMS S5 NL 剩余411.70G 16天后重置
88.3/500G  17.7%  ●●○○○○○○○○
```
