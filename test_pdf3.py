
from apps.payment.pdf_generator import generate_single_pdf
summaries = [{'name': '???????? ???', 'toPayH2': 15070, 'preferableStore': '??? ??????'}]
res = generate_single_pdf(summaries, 2)
with open('test_blank.pdf', 'wb') as f:
    f.write(res)

