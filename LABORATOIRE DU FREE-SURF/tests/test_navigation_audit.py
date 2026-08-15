import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.audit_navigation_buttons import audit_template


class NavigationAuditTests(unittest.TestCase):
    def test_detects_return_and_dashboard_controls(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "profil.html"
            path.write_text(
                """
                <html>
                  <body>
                    <a href="/dashboard">Retour au menu</a>
                    <button onclick="history.back()">Retour</button>
                  </body>
                </html>
                """,
                encoding="utf-8",
            )

            result = audit_template(path)

            self.assertEqual(result.status, "partial")
            self.assertEqual(result.profile, "subpage")
            self.assertFalse(any(control.tag == "div" for control in result.controls))
            categories = {category for control in result.controls for category in control.categories}
            self.assertIn("retour", categories)
            self.assertIn("dashboard", categories)

    def test_marks_template_missing_when_no_nav_control_is_found(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "admin-users.html"
            path.write_text("<html><body><section>Administration</section></body></html>", encoding="utf-8")

            result = audit_template(path)

            self.assertEqual(result.status, "missing")
            self.assertIn("Aucun bouton/lien de navigation detecte", result.notes[0])


if __name__ == "__main__":
    unittest.main()
