"""一个支持本地保存对话历史的 DeepSeek 多轮聊天客户端。"""

import json
import os
from pathlib import Path


def load_history(path: Path) -> list[dict[str, str]]:
    """从 JSON 文件读取历史消息；文件尚不存在时返回空历史。"""
    try:
        messages = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except json.JSONDecodeError as error:
        raise ValueError(f"对话历史不是有效的 JSON：{path}") from error

    # API 要求消息是由 role 和 content 组成的列表，加载后先校验，
    # 避免损坏或手工改错的历史文件被直接发送给模型。
    if not isinstance(messages, list) or any(
        not isinstance(message, dict)
        or message.get("role") not in {"user", "assistant"}
        or not isinstance(message.get("content"), str)
        for message in messages
    ):
        raise ValueError(f"对话历史格式无效：{path}")
    return messages


def save_history(path: Path, messages: list[dict[str, str]]) -> None:
    """把历史消息安全地写入 JSON 文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)

    # 先完整写入临时文件，再一次性替换正式文件；程序中途退出时，
    # 不会只留下写了一半的 chat_history.json。
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(messages, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary_path.replace(path)


def complete_turn(client, model: str, history: list[dict[str, str]], prompt: str):
    """携带已有上下文请求模型，并返回更新后的历史和本轮回答。"""
    # 使用 + 创建新列表，不直接修改传入的 history；只有请求成功后，
    # main 才会采用并保存更新后的历史。
    messages = history + [{"role": "user", "content": prompt}]
    response = client.chat.completions.create(model=model, messages=messages)
    answer = response.choices[0].message.content or ""
    return messages + [{"role": "assistant", "content": answer}], answer


def main() -> None:
    """加载配置和历史，然后启动终端聊天循环。"""
    # 第三方依赖仅在真正运行程序时导入，测试历史读写时无需连接 API。
    from dotenv import load_dotenv
    from openai import OpenAI, OpenAIError

    load_dotenv()
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("缺少 DEEPSEEK_API_KEY，请先复制 .env.example 为 .env 并填写密钥。")

    # 相对路径表示历史文件保存在启动命令所在的目录。
    history_path = Path("chat_history.json")
    try:
        history = load_history(history_path)
    except (OSError, ValueError) as error:
        raise SystemExit(error) from error

    client = OpenAI(
        api_key=api_key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    )
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
    print(f"已恢复 {len(history)} 条消息。输入 /clear 清空历史，/exit 退出。")

    # 每次循环处理一条用户输入；命令、空输入和普通问题分别处理。
    while True:
        try:
            prompt = input("你：").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break

        if prompt == "/exit":
            break
        if prompt == "/clear":
            history = []
            save_history(history_path, history)
            print("历史已清空。")
            continue
        if not prompt:
            continue

        # API 调用失败时不更新 history，用户可以继续输入并重试。
        try:
            updated_history, answer = complete_turn(client, model, history, prompt)
        except OpenAIError as error:
            print(f"请求失败：{error}")
            continue

        history = updated_history
        print(f"AI：{answer}")

        # 回答成功后立即落盘，使下次启动仍能恢复当前上下文。
        try:
            save_history(history_path, history)
        except OSError as error:
            print(f"保存历史失败：{error}")


if __name__ == "__main__":
    main()
