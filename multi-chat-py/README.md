# Multi Chat

本机多轮 AI 对话客户端，提供终端版和 Web 版。Web 版使用 Next.js、Tailwind CSS 与 TanStack Query，支持会话管理、Markdown、流式回答、停止生成、失败重试，以及基于 `Last-Event-ID` 的断线续传和事件去重。

## 从哪里开始读代码

完整的前端发送、服务端领域编排、大模型请求、两段 SSE 解析、持久化和前台渲染
链路见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。文档包含推荐阅读顺序、
请求/响应示例、状态机、关键不变量和故障排查入口。

## 配置

### 密钥安全

- API Key 只写入本机的 `.env` 或 `web/.env.local`，不要提交到 Git。
- 不要把密钥写进浏览器代码、URL、README、截图或聊天消息。
- 截图或日志中一旦出现完整密钥，应立即在服务商控制台撤销并重新创建。
- 修改环境变量后需要重启对应程序。

### Web 版配置

进入 Web 目录并创建本地配置：

```bash
cd web
cp .env.example .env.local
```

编辑 `web/.env.local`：

```env
AI_API_KEY=<你的新 API Key>
AI_BASE_URL=<OpenAI 兼容接口根地址>
AI_MODEL=<接口实际使用的模型 ID 或部署名称>
```

变量说明：

- `AI_API_KEY`：服务商生成的 API Key，只在 Next.js 服务端读取。
- `AI_BASE_URL`：OpenAI Chat Completions 兼容接口的根地址。程序会自动追加 `/chat/completions`，这里不要重复填写该路径。
- `AI_MODEL`：请求体中的 `model` 值，应填写模型 ID 或部署名称，不一定等于控制台里的中文描述。
- `CHAT_STORE_PATH`：可选，Web 会话数据文件路径；默认是 `web/data/chat-store.json`。
- `LEGACY_HISTORY_PATH`：可选，首次导入的 Python 历史文件路径；默认是仓库根目录的 `chat_history.json`。

建议为自定义数据路径使用绝对路径：

```env
CHAT_STORE_PATH=/absolute/path/to/chat-store.json
LEGACY_HISTORY_PATH=/absolute/path/to/chat_history.json
```

#### 阿里云百炼/模型服务配置

截图中应选择“OpenAI 兼容地址”，不要使用单独的 `API Host`，也不要使用 DashScope 的 `/api/v1` 地址。

```env
AI_API_KEY=<重新创建的 API Key>
AI_BASE_URL=https://<你的 API Host>/compatible-mode/v1
AI_MODEL=<模型 ID 或部署名称>
```

最终请求地址由程序组成：

```text
https://<你的 API Host>/compatible-mode/v1/chat/completions
```

如果控制台只展示中文描述，例如“测试用”，还需要在模型或部署详情中找到真正传给 API 的模型 ID/部署名称，填写到 `AI_MODEL`。

#### DeepSeek

```env
AI_API_KEY=<DeepSeek API Key>
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
```

#### OpenAI

```env
AI_API_KEY=<OpenAI API Key>
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=<账号可用的模型 ID>
```

#### 其他兼容服务

只要服务支持以下接口和 SSE 流格式，就可以直接接入：

```text
POST <AI_BASE_URL>/chat/completions
```

请求使用 Bearer Token，并发送兼容 OpenAI Chat Completions 的 `model`、`messages` 和 `stream: true` 字段。

### Web 配置兼容与优先级

Web 版也兼容旧的 `DEEPSEEK_*` 变量。两组变量同时存在时，优先级如下：

```text
AI_API_KEY  > DEEPSEEK_API_KEY
AI_BASE_URL > DEEPSEEK_BASE_URL > 根据密钥类型选择默认地址
AI_MODEL    > DEEPSEEK_MODEL    > 根据密钥类型选择默认模型
```

新配置统一推荐使用 `AI_*`，避免把非 DeepSeek 服务写进名称为 `DEEPSEEK_*` 的变量。

### 终端版配置

终端版保留原有变量名，在仓库根目录创建 `.env`：

```bash
cp .env.example .env
```

DeepSeek 示例：

```env
DEEPSEEK_API_KEY=<DeepSeek API Key>
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

终端版底层同样使用 OpenAI 兼容客户端，因此也可以把 `DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 换成其他兼容服务的地址和模型，但变量名仍保持不变。

Web 版读取 `web/.env.local`，终端版读取仓库根目录 `.env`；需要同时使用两个客户端时，应分别配置。

### 常见配置错误

- `401`：API Key 无效、已撤销，或者复制时包含多余空格。
- `403`：密钥没有模型或工作空间权限。
- `404`：通常是 `AI_BASE_URL` 填错，或错误地重复添加了 `/chat/completions`。
- `400`：通常是 `AI_MODEL` 不是有效的模型 ID/部署名称，或服务并不兼容 Chat Completions。
- `429`：额度不足、触发频率限制或并发限制；程序会对可重试错误执行指数退避和随机抖动。
- 页面仍显示旧模型：保存 `.env.local` 后重启 `pnpm dev`。
- 浏览器不能直接看到 Key：这是正常行为，未以 `NEXT_PUBLIC_` 开头的变量只在服务端使用。

## 安装与运行 Web 版

要求 Node.js 20.9.0 或更高版本，并安装 `pnpm`。

```bash
cd web
pnpm install
pnpm dev
```

访问：

```text
http://127.0.0.1:3000
```

首次启动时，如果仓库根目录存在 `chat_history.json`，程序会将它导入为一个 Web 会话。导入完成后，Web 版和终端版分别维护自己的历史。

## 安装与运行终端版

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python multi_chat.py
```

终端命令：

- `/clear`：清空已保存的对话历史。
- `/exit`：退出程序。

终端历史默认保存在仓库根目录的 `chat_history.json`。

## Web 代码结构

- `web/domains/conversation`：会话模型、查询、界面和本地存储。
- `web/domains/generation`：生成事件、任务生命周期和 OpenAI 兼容模型接入。
- `web/features/chat`：编排会话与生成领域的完整聊天用例。
- `web/app`：Next.js 页面和 HTTP/SSE 路由适配器。
- `web/server`：服务端运行时组装。
- `web/shared`：不包含业务概念的 HTTP 和重试工具。

领域模型不依赖 Next.js 或 React；客户端不得导入 `server` 目录。会话与生成之间的跨领域调用统一放在 `features/chat` 中。

## 测试

```bash
python3 -m unittest -v

cd web
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```
