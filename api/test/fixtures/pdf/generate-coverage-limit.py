"""Build a valid 200-page PDF for testing complete coverage metadata budgets.

Only page one has useful prose. Later pages contain diagram labels whose visual
relationships cannot be extracted. Uses PDF's uncompressed object format.
"""
from pathlib import Path

objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
kids = []
for index in range(200):
    page_id = len(objects) + 1
    kids.append(f"{page_id} 0 R")
    text = "Restore the base backup before replaying archived WAL for database recovery." if index == 0 else "Diagram"
    stream = f"BT /F1 12 Tf 48 760 Td ({text}) Tj ET".encode()
    objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>".encode())
    objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
objects[1] = f"<< /Type /Pages /Count 200 /Kids [{' '.join(kids)}] >>".encode()
data = bytearray(b"%PDF-1.4\n")
offsets = [0]
for number, obj in enumerate(objects, 1):
    offsets.append(len(data))
    data.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
xref = len(data)
data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
for offset in offsets[1:]:
    data.extend(f"{offset:010} 00000 n \n".encode())
data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
Path(__file__).with_name("coverage-limit.pdf").write_bytes(data)
