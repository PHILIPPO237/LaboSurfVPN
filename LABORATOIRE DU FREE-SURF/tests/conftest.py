"""Assure que la racine du projet est sur sys.path, pour que les tests
puissent importer `app.*`, `config`, `database`, etc. même une fois
déplacés dans le dossier tests/.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
