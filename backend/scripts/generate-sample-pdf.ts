/**
 * Regenerates documents/expense-policy.pdf (a sample PDF for demos and evaluation).
 *   npm run samples:pdf
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePdf, wrap } from '../test/fixtures/make-pdf.js';

const page = (...blocks: string[]) => blocks.flatMap((b) => (b.startsWith('#') ? ['', b.slice(1).trim(), ''] : [...wrap(b), '']));

const pages = [
  page(
    '# Acme Robotics Travel and Expense Policy',
    'This policy explains which business expenses Acme Robotics reimburses and how to claim them. Acme Robotics is a fictional company used for demos.',
    '# 1. Submitting Expenses',
    'Expenses must be submitted in the expense tool within 30 days of the purchase. Claims submitted later than 90 days after the purchase are not reimbursed.',
    'A receipt is required for every expense above 25 EUR. For smaller amounts a short description is sufficient. Reimbursements are paid with the next monthly salary.',
    '# 2. Approval',
    'Expenses up to 500 EUR are approved by your manager. Expenses above 500 EUR additionally require approval from the department head. Any single expense above 5,000 EUR must be approved by the finance team before the purchase.',
  ),
  page(
    '# 3. Business Travel',
    'Book flights and hotels through the company travel portal. Economy class is the standard for all flights. Business class is allowed only for flights longer than 6 hours and must be approved in advance by the department head.',
    'Train travel is preferred for trips shorter than 4 hours. First-class train tickets are allowed for trips longer than 2 hours.',
    'Hotel costs are reimbursed up to 150 EUR per night in most cities and up to 220 EUR per night in London, Paris, New York and Tokyo.',
    '# 4. Meals',
    'Meal expenses during business travel are reimbursed up to 50 EUR per day for domestic travel and up to 75 EUR per day for international travel. Alcohol is not reimbursed, except at client dinners approved by your manager.',
  ),
  page(
    '# 5. Mileage',
    'Employees who use their private car for business trips receive 0.30 EUR per kilometre. Commuting between home and the office is not a business trip and is not reimbursed.',
    '# 6. Non-reimbursable Expenses',
    'The following are never reimbursed: traffic and parking fines, personal entertainment such as films in hotels, minibar items, and lost personal belongings.',
    '# 7. Corporate Cards',
    'Employees who travel more than four times per year can request a corporate credit card from the finance team. Corporate cards must not be used for personal purchases. Monthly statements must be reconciled within 10 days.',
  ),
];

const out = fileURLToPath(new URL('../../documents/expense-policy.pdf', import.meta.url));
writeFileSync(out, makePdf(pages));
console.log(`Wrote ${out}`);
