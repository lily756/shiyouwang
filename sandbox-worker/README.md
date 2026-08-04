# Cloudflare Sandbox 远程执行 Worker

这是可选的强隔离后端，不会自动部署。它把 Python、受控文件操作和白名单 Git 操作放进 Cloudflare Sandbox 容器；主 bot 通过 `SANDBOX_API_URL` 和 `SANDBOX_API_TOKEN` 调用。

```bash
cd sandbox-worker
npm install
npx wrangler secret put SANDBOX_API_TOKEN
npm run deploy
```

部署后，在 bot 的 `.env` 中配置：

```dotenv
CODE_EXECUTION_MODE=remote
CODE_EXECUTION_DOCKER_IMAGE=python:3.12-slim
# remote Worker 显式开启互联网出口；本机 docker 模式则用 CODE_EXECUTION_NETWORK_MODE=nat
SANDBOX_API_URL=https://你的-worker.example.com
SANDBOX_API_TOKEN=与上面 secret 相同的随机值
```

本目录需要 Cloudflare 账号、Docker 和相应的 Workers/Containers 权限。Worker 必须保留 `Sandbox` Durable Object 导出；当前实现显式开启 Sandbox 互联网出口，文件接口还支持受限的 base64 二进制读取，主 bot 收到后会用 Telegram `sendDocument` 发回当前私聊。容器只安装 Git，Python 使用 Sandbox 自带环境。主 bot 的 Three.js 公共预览仍由 `VISION_ASSET_SERVER_*` 提供，不依赖 Worker 的端口暴露。
