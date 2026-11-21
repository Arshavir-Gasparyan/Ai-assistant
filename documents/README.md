# Sample documents

Internal documents of **Acme Robotics**, a fictional company. They're used for demos and as the
source of the evaluation golden set (Milestone 15). Don't add real internal or confidential data here.

| File | Format | Covers |
|---|---|---|
| `employee-handbook.md` | Markdown | working hours, remote work, leave, onboarding, learning budget |
| `it-security-policy.md` | Markdown | passwords, MFA, devices, data classification, incidents |
| `expense-policy.pdf` | PDF (3 pages) | expense submission, approvals, travel, meals, mileage |

`expense-policy.pdf` is generated (`cd backend && npm run samples:pdf`), so its text can be
edited in `backend/scripts/generate-sample-pdf.ts`.

Ingest all of them into a running API:

```bash
for f in documents/*.md documents/*.pdf; do
  [ "$(basename "$f")" = README.md ] || curl -s -F "file=@$f" localhost:4000/documents; echo
done
```
