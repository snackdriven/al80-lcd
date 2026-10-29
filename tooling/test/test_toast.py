"""Offline transport checks: no HID imports, clock loop, or PowerShell."""
import ast
import base64
from pathlib import Path
from types import SimpleNamespace
import unittest


class ToastTests(unittest.TestCase):
    def test_encoded_text_round_trips_without_shell_interpolation(self):
        source = Path(__file__).resolve().parents[1] / "al80_clock.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        toast = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "toast")
        module = ast.Module(body=[toast], type_ignores=[])
        captured = []
        namespace = {
            "base64": base64,
            "subprocess": SimpleNamespace(Popen=lambda command: captured.append(command)),
            "log": lambda *args: self.fail("unexpected launch failure"),
        }
        exec(compile(module, str(source), "exec"), namespace)
        samples = [
            ("AL80 Clock", "Keyboard unavailable"),
            ("quotes ' \" & | > %PATH%", "$(Invoke-Command); `whoami`\nsecond line"),
            ("雪 ❄️ {{MESSAGE}}", "🌙 apostrophe's message"),
        ]
        for title, message in samples:
            with self.subTest(title=title):
                namespace["toast"](title, message)
                command = captured.pop()
                self.assertEqual(command[:5], ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand"])
                self.assertEqual(len(command), 6)
                script = base64.b64decode(command[5], validate=True).decode("utf-16le")
                self.assertIn("FromBase64String('%s')" % base64.b64encode(title.encode()).decode(), script)
                self.assertIn("FromBase64String('%s')" % base64.b64encode(message.encode()).decode(), script)
                self.assertIn("CreateTextNode($title)", script)
                self.assertIn("CreateTextNode($msg)", script)


if __name__ == "__main__":
    unittest.main()
