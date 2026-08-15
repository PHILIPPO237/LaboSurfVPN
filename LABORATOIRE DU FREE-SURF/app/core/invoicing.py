"""Generation de factures PDF pour les abonnements/renouvellements valides.

Un numero de facture unique est genere a chaque appel (FACT-<annee>-<sequence>).
Le PDF est ecrit dans static/invoices/ et son chemin relatif est ce qui est
stocke en base (table invoices) -- pas le contenu binaire lui-meme.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def generate_invoice_number(sequence: int) -> str:
    year = datetime.now(timezone.utc).year
    return f"FACT-{year}-{sequence:05d}"


def build_invoice_pdf(
    *,
    output_path: Path,
    invoice_number: str,
    username: str,
    plan: str,
    duration_days: int,
    amount_label: str,
    issued_by_username: str,
    reference: str = "",
) -> None:
    """Ecrit un PDF de facture simple, propre, a l'emplacement demande.
    Cree les dossiers parents si necessaire."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "InvoiceTitle", parent=styles["Title"], fontSize=20, textColor=colors.HexColor("#0a0f0c"),
        spaceAfter=4,
    )
    brand_style = ParagraphStyle(
        "Brand", parent=styles["Normal"], fontSize=11, textColor=colors.HexColor("#1a7a3a"),
        fontName="Helvetica-Bold",
    )
    label_style = ParagraphStyle("Label", parent=styles["Normal"], fontSize=9, textColor=colors.grey)
    normal_style = ParagraphStyle("Body", parent=styles["Normal"], fontSize=11)

    doc = SimpleDocTemplate(
        str(output_path), pagesize=A4,
        topMargin=22 * mm, bottomMargin=22 * mm, leftMargin=20 * mm, rightMargin=20 * mm,
    )

    story: list[Any] = []
    story.append(Paragraph("LABORATOIRE DU FREE-SURF", brand_style))
    story.append(Paragraph("Facture d'activation / renouvellement", title_style))
    story.append(Spacer(1, 6 * mm))

    now_str = datetime.now(timezone.utc).strftime("%d/%m/%Y a %H:%M UTC")
    meta_table_data = [
        ["Numero de facture", invoice_number],
        ["Date d'emission", now_str],
        ["Client", username],
        ["Emise par", issued_by_username or "Systeme"],
    ]
    if reference:
        meta_table_data.append(["Reference", reference])

    meta_table = Table(meta_table_data, colWidths=[55 * mm, 100 * mm])
    meta_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#e0e0e0")),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 10 * mm))

    story.append(Paragraph("Detail", ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13)))
    story.append(Spacer(1, 3 * mm))

    detail_data = [
        ["Description", "Duree", "Montant"],
        [f"Abonnement {plan}", f"{duration_days} jour(s)" if duration_days else "Illimite", amount_label or "—"],
    ]
    detail_table = Table(detail_data, colWidths=[80 * mm, 40 * mm, 35 * mm])
    detail_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0a0f0c")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e0e0e0")),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
    ]))
    story.append(detail_table)
    story.append(Spacer(1, 14 * mm))

    story.append(Paragraph(
        "Ce document confirme l'activation ou le renouvellement de votre acces. "
        "Conservez-le comme justificatif. Pour toute question, contactez votre "
        "revendeur ou l'administrateur via la messagerie de l'application.",
        label_style,
    ))

    doc.build(story)


def next_invoice_sequence(invoices_repo: Any) -> int:
    """Determine le prochain numero de sequence : nombre de factures deja
    emises + 1. Suffisant pour ce volume (pas de creation concurrente a haute
    frequence dans ce contexte)."""
    try:
        return int(invoices_repo.count_all()) + 1
    except Exception:
        return int(time.time()) % 100000  # repli tres improbable de collision
