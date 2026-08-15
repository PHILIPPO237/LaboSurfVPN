import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.application import AppServices, create_application
from app.core.helpers import create_helpers


class HelpersTemplateWarmupTests(unittest.TestCase):
    def test_preload_templates_caches_files(self):
        with TemporaryDirectory() as tmp:
            templates_dir = Path(tmp)
            (templates_dir / "index.html").write_text("INDEX", encoding="utf-8")
            nested_dir = templates_dir / "partials"
            nested_dir.mkdir()
            (nested_dir / "card.html").write_text("CARD", encoding="utf-8")

            helpers = create_helpers(cfg=SimpleNamespace(TEMPLATES_DIR=templates_dir, BASE_DIR=templates_dir))

            self.assertEqual(helpers.preload_templates(["index.html", "partials/card.html"]), 2)
            self.assertEqual(helpers.preload_templates(["index.html", "partials/card.html"]), 0)

            (templates_dir / "index.html").write_text("UPDATED", encoding="utf-8")
            self.assertEqual(helpers.read_template("index.html"), "INDEX")
            self.assertEqual(helpers.read_template(r"partials\card.html"), "CARD")


class ApplicationWarmupTests(unittest.TestCase):
    def test_create_application_starts_template_warmup(self):
        with TemporaryDirectory() as tmp:
            templates_dir = Path(tmp)
            (templates_dir / "index.html").write_text("INDEX", encoding="utf-8")

            calls: list[tuple[str, ...] | None] = []
            background_started = threading.Event()

            def preload_templates(names=None):
                calls.append(None if names is None else tuple(names))
                if names is None:
                    background_started.set()
                return 0

            services = AppServices(
                cfg=SimpleNamespace(APP_NAME="Test", TEMPLATES_DIR=templates_dir),
                preload_templates=preload_templates,
                template_preload_names=("index.html",),
                template_background_warmup_names=None,
            )
            app = create_application(services)

            with TestClient(app) as client:
                response = client.get("/health")

            self.assertEqual(response.status_code, 200)
            self.assertGreaterEqual(len(calls), 1)
            self.assertEqual(calls[0], ("index.html",))
            self.assertTrue(background_started.wait(1.0))


if __name__ == "__main__":
    unittest.main()
