
from apps.payment.pdf_generator import generate_city_pdfs_zip
summaries = [{'name': 'A', 'toPayH2': 1000, 'preferableStore': '??? ??????'}, {'name': 'B', 'toPayH2': 2000, 'preferableStore': '???????'}]
res = generate_city_pdfs_zip(summaries, 2)
print(len(res))

