# meiyeai ecommerce

由 **meiyeai** 维护的电商创作与画布开源版本，基于 Open AI Canvas 开发。

保留公开范围内的电商生图、批量换装、主图与详情图、完整电商画布、普通图片与视频生成、用户管理、积分和通用支付能力。模型服务与支付渠道由部署者自行配置。

**MIT 许可证：允许二次开发和商用，须保留 meiyeai 及上游的版权与许可声明。** 见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 与 [贡献说明](CONTRIBUTING.md)。

第三方组件遵循各自许可，其中 tldraw 绘图组件的生产使用需要部署者自己的有效许可，FFmpeg 内核另有 GPL 条件。详见[第三方许可](docs/THIRD_PARTY_LICENSES.md)。

## 公开边界

视频复刻、剧本创作及电商视频 Agent 的前端、后端、数据模型、迁移和数据均不包含在本仓库中。对应前端入口仅作为禁用图标展示。

指定移除的后台管理功能不提供管理页面或接口。保留功能所需的通用运行组件仍可存在，例如支付适配器、通用任务队列和画布助手运行组件。[完整范围](docs/PUBLIC_SCOPE.md)

不提供原站数据库、用户账号、支付配置、API 密钥、中转地址、预置私有知识库、上传素材或运维记录。请使用全新数据库和存储目录。

## 本地开发

需要 Go 1.25 或兼容版本、C 编译器、Node.js 与 Bun 1.3.9。SQLite 驱动使用 CGO。

在仓库根目录运行以下命令，从源码生成本地测试用的文字、图片和视频请求协议包。Docker 构建会自行打包协议与支付适配器。

```sh
sh plugin-packages/build-packages.sh --protocol openai-chat-completions
sh plugin-packages/build-packages.sh --protocol openai-images
sh plugin-packages/build-packages.sh --protocol openai-videos
```

PowerShell 可使用 `& .\plugin-packages\package-selected.ps1 openai-chat-completions openai-images openai-videos` 做同样的准备。依赖其他模型协议时，按部署者需求打包相应协议。

```sh
cd backend/agent-runtime/pi
npm ci
cd ../..
CANVAS_BACKEND_DATA_DIR=../.local/development go run ./cmd/server
```

另开终端运行前端：

```sh
cd web
bun install --frozen-lockfile
bun run dev
```

访问 `http://localhost:3000`，首次安装时注册管理员，然后配置自己的模型渠道。模型密钥和支付商户配置不写入源码或提交记录。前端开发代理默认指向 `http://127.0.0.1:8080`。

PowerShell 用户在运行后端前使用 `$env:CANVAS_BACKEND_DATA_DIR='../.local/development'` 设置数据目录。

## Docker Compose

复制 `.env.example` 为 `.env`，为 `POSTGRES_PASSWORD` 和 `YINGCE_AGENT_TOKEN` 分别生成独立的随机值。推荐使用至少 32 字符的随机十六进制字符串，避免数据库连接字符串转义问题。按实际部署地址设置 `CANVAS_CORS_ORIGINS` 和 `CANVAS_PUBLIC_BASE_URL`。

```sh
docker compose up -d --build
docker compose ps
```

默认访问 `http://localhost:3000`。数据库、Redis、资源文件和前端静态文件分别保存在命名卷中。首次管理员注册应在受控网络完成；公开服务应配置 HTTPS，默认关闭后续公开注册。

Compose 使用当前仓库源码构建，不会拉取原站的私有业务配置。升级前备份部署者自己的数据卷。

## 检查与限制

```sh
cd web
bun run typecheck
bun run build
cd ../backend
go test ./...
```

真实模型生成和支付交易需要部署者配置并自行验收。编译、测试或模拟调用通过不代表所有供应商兼容性、生成质量和商户交易均已验证。

第三方组件、模型标识与公共分类数据遵循各自许可证；相关声明随对应目录保留。开源许可仅适用于本仓库实际发布的文件，不涉及未发布的私有模块或资料。
