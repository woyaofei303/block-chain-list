import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from multi_chat import complete_turn, load_history, save_history


class MultiChatTest(unittest.TestCase):
    def test_history_survives_restart(self):
        messages = [
            {"role": "user", "content": "世界最高峰是什么？"},
            {"role": "assistant", "content": "珠穆朗玛峰。"},
        ]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.json"
            save_history(path, messages)

            self.assertEqual(load_history(path), messages)

    def test_next_turn_includes_saved_context(self):
        history = [
            {"role": "user", "content": "世界最高峰是什么？"},
            {"role": "assistant", "content": "珠穆朗玛峰。"},
        ]
        client = Mock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="乔戈里峰。"))]
        )

        updated, answer = complete_turn(client, "deepseek-v4-flash", history, "第二高峰呢？")

        expected = history + [{"role": "user", "content": "第二高峰呢？"}]
        client.chat.completions.create.assert_called_once_with(
            model="deepseek-v4-flash", messages=expected
        )
        self.assertEqual(answer, "乔戈里峰。")
        self.assertEqual(
            updated, expected + [{"role": "assistant", "content": "乔戈里峰。"}]
        )


if __name__ == "__main__":
    unittest.main()
