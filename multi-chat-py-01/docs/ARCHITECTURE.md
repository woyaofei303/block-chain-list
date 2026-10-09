# 跟着“我叫小明”看一次聊天如何完成

先按 [README](../README.md) 跑起来，再读本文。我们只追一条主线：用户发送“我叫小明”，页面逐步显示回答，刷新后仍能看到历史。

## 1. 浏览器先登记任务，不直接请求模型

页面入口是 [page.tsx](../web/app/page.tsx)，它挂载 [ChatShell](../web/features/chat/client/chat-shell.tsx)。没有会话时先创建会话，再为这次发送生成 `requestKey`。

浏览器通过 [use-send-message.ts](../web/features/chat/client/use-send-message.ts) 发送：

```http
POST /api/conversations/<conversationId>/messages
Content-Type: application/json
```

```json
{"content":"我叫小明","requestKey":"example-request-1"}
```

`requestKey` 是本次发送的编号。网络层重复提交同一个请求时保留它，服务器才能认出“这是同一次发送”。用户主动重新提问则是新请求。

[Route](../web/app/api/conversations/[id]/messages/route.ts) 先校验未知 JSON：编号只能用允许的字符，内容去空白后不能为空、最多 32,000 字符。TypeScript 类型不能代替这道外部输入检查。

## 2. 先保存消息，再启动生成

[ChatService](../web/features/chat/server/service.ts) 让 [ConversationStore](../web/domains/conversation/server/store.ts) 保存用户消息和一个空的助手位置，再获得 `generationId`（生成任务编号），最后启动模型请求。

为什么先留位置？模型可能很快返回，或者进程中途失败；先保存，就能知道回答属于哪个会话、哪个问题，而不是收到一段无处安放的文字。

重复 `requestKey` 返回原任务并标记 `reused`，不会再次请求模型。成功响应示意为：

```json
{"reused":false,"generationId":"generation-id","assistantMessageId":"assistant-id"}
```

这个响应只表示任务建立。模型可能还没有写出一个字。

## 3. 模型收到哪些历史

Store 取本轮助手占位之前的用户消息与**已经完成**的助手回答。失败、停止的残缺回答不作为下一轮助手上下文，否则模型可能把半句错误答案当成已确认历史。

[运行时](../web/server/runtime.ts) 把模型适配器接给 [GenerationManager](../web/domains/generation/server/manager.ts)。[适配器](../web/domains/generation/server/openai-compatible.ts) 读取服务端配置，发送兼容 Chat Completions 的请求；API Key 不经过浏览器。

## 4. 为什么有两段流

```text
模型服务 → 模型原始 SSE → 服务端解析成文字片段
服务端生成管理器 → 本项目 SSE 事件 → 浏览器缓存 → 页面
```

SSE 是服务器向客户端持续推送事件。模型可能先返回“你”，再返回“好”；服务端把它们汇总成“你好”，同时给浏览器发 delta（增量）事件。

一个网络数据块不一定就是一个完整事件，甚至可能切在 UTF-8 字符中间。适配器先解码、缓冲，按空行切出完整 SSE，再解析 JSON，不能简单把每次读到的内容直接当一条 JSON。

上游请求最多等待 300 秒。尚未收到文字前，可对临时错误退避重试；一旦开始输出就不自动重新请求并拼接，避免把两份不同回答混在一起。

## 5. 页面与磁盘各保存什么

Manager 每收到增量就更新完整正文、发布递增 ID 的事件，并合并高频写入，约每 250ms 保存一次 streaming 快照。结束时先保存 completed，再发 done，保证页面刷新能读到完整结果。

浏览器的 [use-generation-stream.ts](../web/features/chat/client/use-generation-stream.ts) 订阅 `GET /api/generations/<id>?after=N`，[apply-generation-event.ts](../web/features/chat/client/apply-generation-event.ts) 更新缓存，React 因缓存变化重画内容。

```text
streaming → completed：正常完成
streaming → stopped：主动停止
streaming → failed：请求或解析失败
```

即时显示来自 SSE；重新读取的历史来自 Store。Markdown 渲染未启用原始 HTML 执行，模型返回 HTML 不会直接变成可执行网页。

## 6. 用三次故障实验理解恢复

**浏览器断线。** 服务端不因此自动停止任务。浏览器带最后应用的事件 ID 重连，服务端回放更大的 ID；客户端再次去重。最多自动重连 5 次，完成后的缓冲保留 10 分钟。

**用户点击停止。** 浏览器 DELETE 生成任务，服务端 AbortController 请求停止模型，保留已收到正文并标记 stopped。停止不是删除历史。

**点击重试。** 保留原助手消息的位置、清掉残缺正文，但换新 requestKey 和 generationId。这里是用户明确请求新生成，和 HTTP 自动重发旧请求不同。

服务端先订阅实时事件再回放历史，以免衔接时漏消息；这可能短暂重复发送，所以去重仍不可少。

## 7. 程序退出之后还剩什么

默认文件为 `multi-chat-py-01/web/data/chat-store.json`。同一进程的写操作串行执行，先写临时文件，再原子替换正式文件，避免写出半份 JSON。

第一次建库会尝试导入项目目录的 `chat_history.json`；之后 Python 与 Web 各自维护历史。重启不能恢复旧的内存模型连接，遗留 streaming 会变成 failed，可以人工重试。

这套 JSON + 内存事件缓冲面向本机单进程。它不提供跨机器任务恢复，不能把打开另一个服务实例当作续传原任务。

## 8. 排错时从现象找入口

- 发送后无任务编号：查 Route 输入校验和 ChatService 保存阶段。
- 有任务编号但没文字：查模型配置、适配器和上游响应。
- 文字重复：查事件 ID 与缓存应用，不先修改模型提示词。
- 刷新丢结果：查 Store 路径、落盘和终态发布顺序。
- 删除会话后又出现：检查删除前是否停止并等待活动生成。

从项目 `web/` 运行 `pnpm test`、`pnpm typecheck`，对照 `web/tests/` 的行为断言。2026-10-09 已通过 14 项 Web 测试及类型检查，其中重启恢复用两个同时生成的会话验证，避免只恢复第一条记录。
