from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from pathlib import Path

LABEL_PATTERNS = {
    "retour": re.compile(r"\b(retour|revenir|precedent|pr[ée]c[ée]dent|back)\b", re.IGNORECASE),
    "menu": re.compile(r"\b(menu|navigation|naviguer)\b", re.IGNORECASE),
    "accueil": re.compile(r"\b(accueil|home|hub)\b", re.IGNORECASE),
    "dashboard": re.compile(r"\b(dashboard|tableau de bord)\b", re.IGNORECASE),
    "admin": re.compile(r"\b(admin|administration)\b", re.IGNORECASE),
}

TARGET_PATTERNS = {
    "retour": re.compile(r"(history\.back|javascript:\s*history\.back|\.\./|return|retour)", re.IGNORECASE),
    "menu": re.compile(r"(menu|nav|navigation)", re.IGNORECASE),
    "accueil": re.compile(r"(/$|index|accueil|home)", re.IGNORECASE),
    "dashboard": re.compile(r"(dashboard|panel|hub)", re.IGNORECASE),
    "admin": re.compile(r"(admin)", re.IGNORECASE),
}

INTERACTIVE_TAGS = {"a", "button"}
INTERACTIVE_ROLES = {"button", "link"}
EXCLUDED_FILES = {"base.html"}


@dataclass
class NavControl:
    tag: str
    label: str
    target: str
    line: int
    categories: list[str] = field(default_factory=list)


@dataclass
class TemplateAuditResult:
    template: str
    profile: str
    status: str
    controls: list[NavControl] = field(default_factory=list)
    missing_categories: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class NavHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.controls: list[NavControl] = []
        self._current: dict | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: value or "" for key, value in attrs}
        if self._is_nav_control(tag, attr_map):
            self._current = {
                "tag": tag,
                "target": attr_map.get("href") or attr_map.get("onclick") or attr_map.get("data-href") or "",
                "line": self.getpos()[0],
                "chunks": [],
                "attrs": attr_map,
            }

    def handle_data(self, data: str) -> None:
        if self._current is not None:
            self._current["chunks"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._current is None or self._current["tag"] != tag:
            return
        label = self._normalize_label(" ".join(self._current["chunks"]), self._current["attrs"])
        target = self._current["target"].strip()
        categories = sorted(set(self._categorize(label, target)))
        self.controls.append(
            NavControl(
                tag=self._current["tag"],
                label=label,
                target=target,
                line=self._current["line"],
                categories=categories,
            )
        )
        self._current = None

    @staticmethod
    def _is_nav_control(tag: str, attrs: dict[str, str]) -> bool:
        if tag in INTERACTIVE_TAGS:
            return True
        role = attrs.get("role", "").lower()
        return role in INTERACTIVE_ROLES

    @staticmethod
    def _normalize_label(text: str, attrs: dict[str, str]) -> str:
        raw = text or attrs.get("aria-label") or attrs.get("title") or attrs.get("id") or attrs.get("class", "")
        return re.sub(r"\s+", " ", raw).strip()

    @staticmethod
    def _categorize(label: str, target: str) -> list[str]:
        haystacks = [label, target]
        categories: list[str] = []
        for name, pattern in LABEL_PATTERNS.items():
            if any(pattern.search(value or "") for value in haystacks):
                categories.append(name)
                continue
            target_pattern = TARGET_PATTERNS.get(name)
            if target_pattern and target_pattern.search(target or ""):
                categories.append(name)
        return categories


def profile_for_template(name: str) -> tuple[str, set[str]]:
    lowered = name.lower()
    if lowered.startswith("admin-"):
        return "admin", {"admin", "dashboard", "menu", "retour"}
    if lowered in {"dashboard.html", "panel-vip.html", "panel-gratuit.html", "panel-revendeur.html"}:
        return "hub", {"dashboard", "menu", "accueil"}
    if any(token in lowered for token in ("compte", "profil", "consommation", "options", "payment", "abonnement", "scan-guide", "tchat")):
        return "subpage", {"retour", "menu", "dashboard", "accueil"}
    if any(token in lowered for token in ("access", "forgot", "reset", "inscription", "vip-login")):
        return "auth", {"retour", "accueil"}
    return "generic", {"menu", "accueil", "retour"}


def audit_template(path: Path) -> TemplateAuditResult:
    profile, expected = profile_for_template(path.name)
    parser = NavHTMLParser()
    content = path.read_text(encoding="utf-8-sig")
    parser.feed(content)

    matched_controls = [control for control in parser.controls if control.categories]
    found_categories = {category for control in matched_controls for category in control.categories}
    missing = sorted(expected - found_categories)

    notes: list[str] = []
    status = "ok"
    if not matched_controls:
        status = "missing"
        notes.append("Aucun bouton/lien de navigation detecte par l'audit.")
    elif missing:
        status = "partial"
        notes.append("Navigation detectee, mais certaines categories attendues sont absentes.")

    return TemplateAuditResult(
        template=path.name,
        profile=profile,
        status=status,
        controls=matched_controls,
        missing_categories=missing,
        notes=notes,
    )


def audit_templates(templates_dir: Path) -> list[TemplateAuditResult]:
    results: list[TemplateAuditResult] = []
    for path in sorted(templates_dir.glob("*.html")):
        if path.name in EXCLUDED_FILES:
            continue
        results.append(audit_template(path))
    return results


def render_text_report(results: list[TemplateAuditResult]) -> str:
    lines = ["AUDIT NAVIGATION", ""]
    totals = {
        "ok": sum(1 for result in results if result.status == "ok"),
        "partial": sum(1 for result in results if result.status == "partial"),
        "missing": sum(1 for result in results if result.status == "missing"),
    }
    lines.append(
        f"Templates analyses: {len(results)} | ok: {totals['ok']} | partial: {totals['partial']} | missing: {totals['missing']}"
    )
    lines.append("")
    for result in results:
        lines.append(f"- {result.template} [{result.profile}] -> {result.status}")
        if result.missing_categories:
            lines.append(f"  categories manquantes: {', '.join(result.missing_categories)}")
        if result.controls:
            for control in result.controls:
                target = control.target or "(sans cible)"
                lines.append(
                    f"  ligne {control.line}: <{control.tag}> '{control.label}' -> {target} [{', '.join(control.categories)}]"
                )
        if result.notes:
            for note in result.notes:
                lines.append(f"  note: {note}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(description="Audit des boutons de navigation dans les templates HTML.")
    parser.add_argument("--templates-dir", default="templates", help="Dossier contenant les templates HTML.")
    parser.add_argument("--json", action="store_true", help="Sortie JSON au lieu d'un rapport texte.")
    args = parser.parse_args(argv)

    templates_dir = Path(args.templates_dir)
    if not templates_dir.exists():
        print(f"Dossier introuvable: {templates_dir}", file=sys.stderr)
        return 2

    results = audit_templates(templates_dir)
    if args.json:
        payload = [asdict(result) for result in results]
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(render_text_report(results))

    return 0 if all(result.status == "ok" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
