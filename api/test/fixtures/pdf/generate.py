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

# Image-only printed pages, deliberately without a selectable PDF text layer.
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Courier New.ttf', 26)
scan = Image.new('RGB', (1600, 2000), 'white')
draw = ImageDraw.Draw(scan)
for index, line in enumerate([
    'PostgreSQL printed recovery checklist',
    'Restore the base backup before replaying archived WAL.',
    'SCAN_RECOVERY_MARKER identifies the printed recovery procedure.',
    'SELECT pg_switch_wal();',
    'Keep transaction logs until the recovery check succeeds.',
]):
    draw.text((100, 140 + index * 65), line, font=font, fill='black')
for name, kinds in [('printed-scan', ['scan']), ('mixed', ['native', 'scan', 'gap', 'blank']),
                    ('scan-blank', ['scan-blank']), ('no-evidence', ['gap']),
                    ('blank-pages', ['native', 'scan-blank', 'blank'])]:
    pdf = canvas.Canvas(str(root / (name + '.pdf')), invariant=1)
    for kind in kinds:
        if kind == 'native':
            for index, line in enumerate(pages[0]):
                pdf.drawString(48, 760 - index * 24, line)
        elif kind in ('scan', 'scan-blank'):
            image = scan if kind == 'scan' else Image.new('RGB', scan.size, 'white')
            pdf.drawImage(ImageReader(image), 0, 0, width=595, height=842)
        elif kind == 'gap':
            pdf.circle(200, 500, 80, fill=1)
            pdf.drawString(48, 760, 'Diagram')
        pdf.showPage()
    pdf.save()
