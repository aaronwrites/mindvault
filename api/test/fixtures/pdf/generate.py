"""Rebuild small original fixtures: Python, reportlab, and pypdf (development only)."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pdfencrypt import StandardEncryption
from pypdf import PdfReader, PdfWriter

root = Path(__file__).parent
pages = [
    ["PostgreSQL recovery field guide",
     "Write-ahead logging keeps committed transactions durable after a crash.",
     "The WAL_RECOVERY_TARGET identifier selects the recovery destination."],
    ["Physical page two - printed page 1",
     "Point-in-time recovery replays archived WAL to restore an earlier state.",
     "Operators take regular base backups before replaying the transaction log.",
     "SELECT pg_switch_wal(); -- force a transaction log segment switch"],
]
for name, content, encryption in [
    ("selectable", pages, None),
    ("empty", [[]], None),
    ("encrypted", pages, StandardEncryption("secret")),
    ("generation-limit", [pages[0] * 6] * 40, None),
    ("partial-native", [pages[0], ["Diagram"], []], None),
]:
    path = root / (name + ".pdf")
    pdf = canvas.Canvas(str(path), encrypt=encryption, invariant=1)
    pdf.setTitle("PostgreSQL recovery field guide")
    for lines in content:
        y = 760
        for line in lines:
            pdf.drawString(48, y, line)
            y -= 24
        pdf.showPage()
    pdf.save()
    if name == "selectable":
        writer = PdfWriter(clone_from=PdfReader(path))
        writer.set_page_label(0, 0, style="/r", start=1)
        writer.set_page_label(1, 1, style="/D", start=1)
        writer.write(path)

# Intentionally paint the second visible line first: stream order is not reading order.
pdf = canvas.Canvas(str(root / "reading-order.pdf"), invariant=1)
pdf.drawString(48, 700, "Second: replay archived WAL to recover committed transactions.")
pdf.drawString(48, 760, "First: restore the base backup before replaying any transaction logs.")
pdf.showPage()
pdf.save()
