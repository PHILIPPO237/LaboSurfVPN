import io
import unittest

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.testclient import TestClient

from app.routers.admin_ads import create_admin_ads_router


class _AdsRepo:
    def __init__(self):
        self._rows = []
        self._next_id = 1

    def get_all(self):
        return [dict(r) for r in self._rows]

    def get_by_id(self, ad_id: int):
        for row in self._rows:
            if int(row.get("id", 0)) == int(ad_id):
                return dict(row)
        return None

    def save(self, ad: dict):
        item = dict(ad)
        if int(item.get("id", 0) or 0) <= 0:
            item["id"] = self._next_id
            self._next_id += 1
            self._rows.append(item)
            return dict(item)

        ad_id = int(item["id"])
        for idx, row in enumerate(self._rows):
            if int(row.get("id", 0)) == ad_id:
                self._rows[idx] = item
                return dict(item)
        self._rows.append(item)
        return dict(item)

    def delete(self, ad_id: int):
        before = len(self._rows)
        self._rows = [r for r in self._rows if int(r.get("id", 0)) != int(ad_id)]
        return len(self._rows) < before


class _DB:
    def __init__(self):
        self.ads = _AdsRepo()


class AdminAdsRouterTests(unittest.TestCase):
    def _client(self):
        deleted_images = []

        def require_access(_request, _allowed, *, next_url="/", need=""):
            del next_url, need
            return {"type": "ADMIN", "username": "admin"}

        def require_admin_api(_request):
            return {"type": "ADMIN", "username": "admin"}

        def read_template(name: str):
            if name == "admin-ads.html":
                return "<h1>ADS</h1>"
            return None

        def html_response(content: str, status_code: int = 200):
            return HTMLResponse(content=content, status_code=status_code)

        async def save_ad_upload(_upload):
            return "/static/ads/uploaded.png"

        def delete_ad_image(path: str):
            deleted_images.append(path)

        app = FastAPI()
        db = _DB()
        app.include_router(
            create_admin_ads_router(
                db=db,
                require_access=require_access,
                require_admin_api=require_admin_api,
                read_template=read_template,
                html_response=html_response,
                serialize_ads=lambda: db.ads.get_all(),
                save_ad_upload=save_ad_upload,
                delete_ad_image=delete_ad_image,
                coerce_locations=lambda v: ["chat"] if not v else ["chat", "dashboard"] if "dashboard" in str(v) else ["chat"],
            )
        )
        return TestClient(app), db, deleted_images

    def test_page_and_list(self):
        client, _db, _deleted = self._client()
        page = client.get("/admin/ads")
        self.assertEqual(page.status_code, 200)
        self.assertIn("ADS", page.text)

        listed = client.get("/api/admin/ads")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["ads"], [])

    def test_save_json_and_delete(self):
        client, db, deleted_images = self._client()

        created = client.post(
            "/api/admin/ads",
            json={
                "id": 0,
                "text": "Promo VIP",
                "link": "https://example.com",
                "priority": 2,
                "active": True,
                "locations": ["chat"],
                "style": "neon",
                "expires_at": 0,
            },
        )
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["status"], "ok")
        ad_id = created.json()["ad"]["id"]

        listed = client.get("/api/admin/ads")
        self.assertEqual(len(listed.json()["ads"]), 1)

        removed = client.post("/api/admin/ads/delete", json={"id": ad_id})
        self.assertEqual(removed.status_code, 200)
        self.assertTrue(removed.json()["deleted"])
        self.assertEqual(db.ads.get_all(), [])
        self.assertEqual(deleted_images, [])

    def test_save_multipart_upload_sets_image(self):
        client, _db, _deleted = self._client()

        multipart = client.post(
            "/api/admin/ads",
            data={
                "id": "0",
                "text": "Banner",
                "priority": "1",
                "active": "true",
                "style": "neon",
                "duration_hours": "2",
                "locations": "[\"chat\",\"dashboard\"]",
            },
            files={"file": ("banner.png", io.BytesIO(b"fakepng"), "image/png")},
        )
        self.assertEqual(multipart.status_code, 200)
        self.assertEqual(multipart.json()["status"], "ok")
        self.assertEqual(multipart.json()["ad"]["image"], "/static/ads/uploaded.png")


if __name__ == "__main__":
    unittest.main()
