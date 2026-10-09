# 01 · 做一个能记住上下文的聊天程序

这个项目解决一个熟悉的问题：问完“我叫小明”，再问“我叫什么”，程序怎样把前一句带给模型？你会先运行聊天，再理解历史保存、逐字显示、停止与重试。它是通用应用练习，不涉及区块链。

有两个入口：Python 终端版适合理解最短流程；Web 版增加会话列表和流式回答。两者独立运行，Web 不会调用 Python。

## 先用一个例子理解

1. 你输入“我叫小明”，程序把它加入本轮请求。
2. 模型回答后，程序保存用户问题与助手回答。
3. 你再问“我叫什么”，程序把可用的历史和新问题一起发送。
4. 模型据此回答。所谓“记住”主要是应用再次提供历史，不是模型永久记住了你。

终端版在整轮请求成功后才更新历史；Web 版先保存用户消息和助手占位，再逐步保存回答。请求失败时，这两种保存策略的表现不同。

## 第一次运行：任选一个入口

所有 `cd` 命令从本仓库根目录开始。需要 Python 3，或 Node.js 20.9+ 与 pnpm；模型调用还需要你自己的兼容服务配置。先用测试学习时无需发起真实模型请求。

### 终端版：先看懂一问一答

```bash
cd multi-chat-py-01
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
test -f .env || cp .env.example .env
```

编辑该目录的 `.env`，只在本机填写凭据：

```dotenv
DEEPSEEK_API_KEY=<服务商密钥>
DEEPSEEK_BASE_URL=<兼容接口根地址>
DEEPSEEK_MODEL=<模型ID>
```

仍在 `multi-chat-py-01` 执行：

```bash
python multi_chat.py
```

依次输入上面的两句话，观察第二次回答；输入 `/exit` 退出。历史写入**启动程序的当前目录**下的 `chat_history.json`。`/clear` 会清空这份历史，练习时先确认没有需要保留的内容。

### Web 版：观察一段回答怎样逐步出现

```bash
cd multi-chat-py-01/web
pnpm install
test -f .env.local || cp .env.example .env.local
```

编辑 `web/.env.local`：

```dotenv
AI_API_KEY=<服务商密钥>
AI_BASE_URL=<兼容接口根地址>
AI_MODEL=<模型ID或部署名称>
```

程序会在根地址后追加 `/chat/completions`，不要重复填写这部分。密钥只由服务端读取，不使用 `NEXT_PUBLIC_` 前缀。保存后执行：

```bash
pnpm dev
```

打开 `http://127.0.0.1:3000`，新建会话、发送问题，再试一次停止和重试。预期能看到文字逐步出现；刷新后已保存的消息仍在。

默认历史保存在 `web/data/chat-store.json`。首次建库时会尝试导入 `multi-chat-py-01/chat_history.json`；之后两份历史各自维护。可用 `CHAT_STORE_PATH`、`LEGACY_HISTORY_PATH` 指定绝对路径。Web 兼容旧 `DEEPSEEK_*` 配置，若同时存在则 `AI_*` 优先。

## 点击发送后，谁调用谁

```text
浏览器发送 JSON → Route 校验 → ChatService 保存本轮并启动生成
模型返回文字片段 → GenerationManager 汇总和保存
浏览器订阅 SSE → 更新页面缓存 → 显示回答
```

JSON 是传递结构化数据的文本格式。SSE 是服务器持续向浏览器推送事件的连接，可以理解为“答案写一段，寄一段”。首次 POST 返回的 `generationId` 是任务编号，不是最终答案。

`requestKey` 是一次发送的编号。同一次 HTTP 请求重发时复用它，服务端会返回原任务，避免重复生成。SSE 的事件编号则用于断线后续收、去掉重复片段；两种编号解决的问题不同。

断线不等于停止。点击停止会请求服务端终止生成；重试会建立新的生成任务。已经显示过部分文字后，不直接拼接另一次模型回答，以免混出错误内容。

## 对照代码学习

1. [multi_chat.py](multi_chat.py)：读 `complete_turn`，看历史如何随成功请求更新。
2. [聊天服务](web/features/chat/server/service.ts)：看 Web 为什么先落盘再开始生成。
3. [生成管理器](web/domains/generation/server/manager.ts)：看事件、停止和保存如何衔接。
4. [架构讲解](docs/ARCHITECTURE.md)：沿同一条消息追到浏览器，进一步理解缓存与失败恢复。

## 验证与排错

从仓库根目录分别进入对应目录执行；2026-10-09 已通过 2 项 Python 测试、14 项 Web 测试，以及 Web 的 lint 和类型检查。重启恢复已覆盖两个会话同时中断：所有残留的生成状态都会改为可重试的失败状态，已有消息保留。

```bash
cd multi-chat-py-01
python3 -m unittest -v
```

```bash
cd multi-chat-py-01/web
pnpm test
pnpm lint
pnpm typecheck
```

- `401/403`：检查密钥及模型权限；不要把密钥粘进日志求助。
- `404`：检查根地址是否多写或少写了接口路径。
- 修改配置没生效：重启当前服务。
- 页面刷新后没有历史：先确认启动目录和存储路径，不要新建空文件覆盖原记录。

学会的标志：能解释“发送成功”和“回答完成”为什么是两个时刻，以及为何重试请求不应该生成两份答案。
