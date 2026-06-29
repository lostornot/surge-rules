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
