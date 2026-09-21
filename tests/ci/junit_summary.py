#!/usr/bin/env python3
"""Resume des tests unitaires Android (JUnit XML) pour la CI : annotation de synthese, annotations des echecs.
Usage : python3 tests/ci/junit_summary.py [--fail-if-empty]   (sortie 1 s'il y a un echec / une erreur / aucun test)."""
import glob
import sys
import xml.etree.ElementTree as ET

tests = failures = errors = 0
for path in glob.glob("app/build/test-results/testDebugUnitTest/*.xml"):
    root = ET.parse(path).getroot()
    tests += int(root.get("tests", 0)); failures += int(root.get("failures", 0)); errors += int(root.get("errors", 0))
    for tc in root.iter("testcase"):
        for kind in ("failure", "error"):
            node = tc.find(kind)
            if node is not None:
                msg = (node.get("message") or "")[:300].replace("%", "%25").replace("\n", " ")
                print(f"::error title=Test unitaire en echec::{tc.get('classname')}.{tc.get('name')} : {msg}")
print(f"::notice title=Tests unitaires Android::{tests} tests, {failures} echecs, {errors} erreurs")
sys.exit(1 if (failures or errors or (tests == 0 and "--fail-if-empty" in sys.argv)) else 0)
