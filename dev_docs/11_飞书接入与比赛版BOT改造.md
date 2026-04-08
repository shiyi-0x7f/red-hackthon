# 飞书接入与比赛版 BOT 改造（提交版）

> 项目：AI 自适应数学学习系统（MVP）  
> 目标：让飞书侧 BOT 从“开发者工具风格”切换为“比赛 Demo 展示风格”  
> 对齐范围：`/start /goal /plan /checkin /mode`（与 MVP 文档一致）

---

## 1. 本次交付结论

我们已经完成以下事项：

1. 飞书 BOT 接入路径确认：使用 AstrBot `lark` 平台 + `socket`（长连接）模式。
2. 飞书权限方案整理：提供可导入的 scopes JSON。
3. 比赛版文案改造落地：
   - `/help` 改为固定 6 行比赛引导文案（不再显示内置开发命令全集）。
   - `/start` 改为比赛首屏入门文案（去掉 `student_uid` 和 `/upload` 暴露）。
4. 运行问题排查经验沉淀：若飞书仍返回旧 `/help`，通常是后端未重启到新代码。

---

## 2. 与 MVP 文档的对齐

与下列文档保持一致：

1. `06_Phase1_节奏控制与轻量对话.md`
2. `MVP_开发文档.md`
3. `00_项目总览与原则.md`

MVP 飞书侧主命令：

1. `/start`
2. `/goal <目标>`
3. `/plan`
4. `/checkin`
5. `/mode strict|gentle`

---

## 3. 飞书开放平台配置（比赛可复用）

### 3.1 订阅模式

使用长连接（Socket）模式，避免 Webhook 域名/证书成本。

### 3.2 权限导入

仓库内提供：

1. `dev_docs/feishu_scopes_import.json`：比赛可用权限集（tenant + user）
2. `dev_docs/feishu_scopes_export_template.json`：空模板

导入后务必执行：

1. 保存权限配置
2. 创建版本并发布（未发布不会生效）

---

## 4. AstrBot 配置要点（飞书）

`lark` 平台配置建议：

1. `app_id`：飞书应用 App ID
2. `app_secret`：飞书应用 App Secret
3. `lark_connection_mode`：`socket`
4. `domain`：`https://open.feishu.cn`
5. `lark_encrypt_key` / `lark_verification_token`：Socket 模式可留空

注意：

1. 不要在仓库提交任何真实 `API Key/App Secret`。
2. 若 BOT 不回复，先确认模型 Provider 已配置并可用。

---

## 5. 比赛版文案改造（代码侧）

已改造目标文件：

1. `E:\AstrBot\backend\app\astrbot\builtin_stars\builtin_commands\commands\help.py`
2. `E:\AstrBot\backend\app\astrbot\builtin_stars\dedicated_tutor_agent\main.py`

### 5.1 `/help` 目标效果

固定展示为：

1. 我是六年级数学学习搭子，先从下面命令开始：
2. /start 开始学习会话
3. /goal 你的学习目标
4. /plan 查看个性化学习计划
5. /checkin 今日总结与复盘
6. /mode strict|gentle 切换学习模式

### 5.2 `/start` 目标效果

1. 不展示 `student_uid`
2. 不在首屏展示 `/upload`
3. 首屏只引导 MVP 核心命令

---

## 6. 常见问题与排查

### 问题：飞书里 `/help` 仍然显示 `AstrBot v...` + 大量开发命令

常见原因：进程仍在跑旧代码（未重启到新版本）。

排查与处理：

1. 检查正在运行的后端进程命令行（是否对应当前代码目录）
2. 终止 AstrBot 相关进程（桌面端 + 后端 python）
3. 重新启动后端并重开桌面端
4. 再次在飞书发 `/help` 验证

---

## 7. 比赛验收清单（飞书侧）

1. `/help` 仅显示比赛版 6 行，不出现 `/plugin` `/provider` 等开发命令。
2. `/start` 不出现 `student_uid`，不出现 `/upload`。
3. `/goal` `/plan` `/mode strict` `/checkin ...` 正常可用。
4. 机器人回复风格为中文、简洁、学习搭子语气。

---

## 8. 提交说明（给评审/队友）

本提交覆盖“飞书端可演示性”关键链路：

1. 接入：飞书可稳定收发
2. 展示：命令引导符合 MVP 业务目标
3. 风格：去开发者化，提升评委理解速度
4. 可复现：权限 JSON + 验收清单已沉淀

