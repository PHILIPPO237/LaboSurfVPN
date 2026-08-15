import os
import sys
import tempfile
import unittest
import uuid
from importlib import util
from pathlib import Path
from unittest import mock

ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_CONFIG = ROOT_DIR / "app" / "core" / "config.py"


def load_config_from_directory(directory: Path):
    # config.py vit maintenant dans app/core/ ; _CONFIG_DIR y remonte de 3 niveaux
    # jusqu'à la racine du projet, donc on reproduit cette structure imbriquée
    # dans le repertoire temporaire pour que la resolution de .env reste identique
    # au comportement reel.
    config_path = directory / "app" / "core" / "config.py"
    module_name = f"temp_config_{uuid.uuid4().hex}"
    spec = util.spec_from_file_location(module_name, config_path)
    module = util.module_from_spec(spec)
    assert spec.loader is not None
    # config.py definit `cfg = sys.modules[__name__]` en fin de fichier ; le module
    # doit donc etre enregistre dans sys.modules avant exec_module, comme le ferait
    # le mecanisme d'import standard.
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(module_name, None)
    return module


class EnvironmentConfigTests(unittest.TestCase):
    def write_module_fixture(
        self,
        tmpdir: Path,
        *,
        base_env: str = "",
        profile_name: str | None = None,
        profile_env: str = "",
        explicit_name: str | None = None,
        explicit_env: str = "",
    ) -> None:
        config_dest = tmpdir / "app" / "core" / "config.py"
        config_dest.parent.mkdir(parents=True, exist_ok=True)
        config_dest.write_text(SOURCE_CONFIG.read_text(encoding="utf-8"), encoding="utf-8")
        (tmpdir / ".env").write_text(base_env, encoding="utf-8")
        if profile_name is not None:
            (tmpdir / f".env.{profile_name}").write_text(profile_env, encoding="utf-8")
        if explicit_name is not None:
            (tmpdir / explicit_name).write_text(explicit_env, encoding="utf-8")

    def load_with_env(self, tmpdir: Path, extra_env: dict[str, str] | None = None):
        env = {
            "FS_CSRF_SECRET": "unit-test-secret",
            "FS_ENV": "",
            "FS_ENV_FILE": "",
        }
        if extra_env:
            env.update(extra_env)
        with mock.patch.dict(os.environ, {}, clear=True):
            os.environ.update(env)
            return load_config_from_directory(tmpdir)

    def test_fs_env_profile_overrides_base_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            self.write_module_fixture(
                tmpdir,
                base_env="FS_UVICORN_PORT=8000\nFS_COOKIE_SECURE=0\n",
                profile_name="production",
                profile_env="FS_UVICORN_PORT=9000\nFS_COOKIE_SECURE=1\n",
            )
            module = self.load_with_env(tmpdir, {"FS_ENV": "production"})
            self.assertEqual(module.UVICORN_PORT, 9000)
            self.assertTrue(module._COOKIE_SECURE)

    def test_fs_env_file_overrides_default_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            self.write_module_fixture(
                tmpdir,
                base_env="FS_UVICORN_PORT=8000\n",
                explicit_name="custom.env",
                explicit_env="FS_UVICORN_PORT=9100\n",
            )
            module = self.load_with_env(tmpdir, {"FS_ENV_FILE": "custom.env"})
            self.assertEqual(module.UVICORN_PORT, 9100)

    def test_process_environment_keeps_highest_priority(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            self.write_module_fixture(
                tmpdir,
                base_env="FS_UVICORN_PORT=8000\n",
                profile_name="production",
                profile_env="FS_UVICORN_PORT=9000\n",
            )
            module = self.load_with_env(
                tmpdir,
                {
                    "FS_ENV": "production",
                    "FS_UVICORN_PORT": "7000",
                },
            )
            self.assertEqual(module.UVICORN_PORT, 7000)


if __name__ == "__main__":
    unittest.main()
