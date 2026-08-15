from fastapi.templating import Jinja2Templates
from app.core.config import cfg

# Initialisation globale du moteur de templates Jinja2.
# FastAPI (via Starlette) s'occupe automatiquement de la mise en cache en production !
templates = Jinja2Templates(directory=str(cfg.TEMPLATES_DIR))