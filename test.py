import csv
with open('schedule.csv', encoding='utf-8') as f:
    reader = csv.reader(f)
    headers = next(reader)
    issues = {}
    for row in reader:
        date = row[0]
        for name in row[1:]:
            if not name.strip(): continue
            if name != ' '.join(name.split()):
                if name not in issues: issues[name] = []
                issues[name].append(date)
with open('output.txt', 'w', encoding='utf-8') as out:
    for name, dates in issues.items():
        out.write(f"{name!r}: {len(dates)} shifts on {', '.join(dates)}\n")
