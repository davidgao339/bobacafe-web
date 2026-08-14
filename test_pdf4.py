
from fpdf import FPDF
pdf = FPDF()
pdf.add_page()
pdf.set_font('Helvetica', size=12)
pdf.cell(0, 10, 'Hello')
b1 = bytes(pdf.output())

import io
pdf2 = FPDF()
pdf2.add_page()
pdf2.set_font('Helvetica', size=12)
pdf2.cell(0, 10, 'Hello')
buf = io.BytesIO()
pdf2.output(buf)
b2 = buf.getvalue()

print(len(b1), len(b2), b1 == b2)

