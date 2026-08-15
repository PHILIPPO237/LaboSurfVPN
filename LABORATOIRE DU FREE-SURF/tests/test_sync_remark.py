import os
import unittest


class SyncRemarkSmokeTests(unittest.IsolatedAsyncioTestCase):
    async def test_3xui_items_have_expected_shape(self):
        if os.getenv("FS_RUN_NETWORK_TESTS", "0") != "1":
            self.skipTest("Set FS_RUN_NETWORK_TESTS=1 to enable network smoke tests.")

        try:
            from main import fetch_3xui_data
        except ModuleNotFoundError as exc:
            self.skipTest(f"main/app stack unavailable: {exc}")

        base_url = str(os.getenv("FS_XUI_URL", "")).strip()
        username = str(os.getenv("FS_XUI_USER", "")).strip()
        password = str(os.getenv("FS_XUI_PASS", "")).strip()
        if not (base_url and username and password):
            self.skipTest("FS_XUI_URL, FS_XUI_USER and FS_XUI_PASS are required.")

        items = await fetch_3xui_data(base_url, username, password)
        self.assertIsInstance(items, list)
        if items:
            sample = items[0]
            self.assertIn("name", sample)
            self.assertIn("protocol", sample)
            self.assertIn("port", sample)


if __name__ == "__main__":
    unittest.main()
