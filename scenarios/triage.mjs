// Support-ticket triage for "Ledgerly", a fictional invoicing and payouts product.
// PRE-REGISTERED: inputs, author labels and tiers were written before any recorded run.
// Rule: never delete an item because an engine got it wrong.
import { createHash } from 'node:crypto';

export const product = 'Ledgerly (fictional invoicing and payouts service)';

export const questionBank = {
  department: { type: 'choice', instructions: 'Which team should handle this ticket?', criteria: {
    billing: 'Charges, invoices, refunds, payout amounts, payment methods.',
    technical: 'Bugs, errors, outages, API or integration problems.',
    account: 'Login, passwords, permissions, profile details, or security of the account.',
    sales: 'Pricing, plans, upgrades, quotes, new purchases.',
    other: 'Anything else, including general feedback and spam.' } },
  frustration: { type: 'score', instructions: 'How frustrated does the customer appear?', criteria: [
    'Calm and neutral.', 'Concerned but civil.', 'Clearly frustrated.', 'Very angry or using strong language.'] },
  refund_requested: { type: 'noul', instructions: 'Does the customer ask for money to be returned to them?' },
  urgency: { type: 'score', instructions: 'How time-critical is this for the customer?', criteria: [
    'No time pressure mentioned.', 'They want it handled soon.', 'Their business is blocked right now or a hard deadline is at risk.'] },
  churn_risk: { type: 'noul', instructions: 'Does the customer threaten to cancel or to switch to another provider?' },
  intent: { type: 'choice', instructions: 'What is the customer mainly doing in this message?', criteria: {
    report_problem: 'Reporting that something is broken or went wrong.',
    ask_question: 'Asking for information.',
    request_change: 'Asking for something to be changed, added, or set up.',
    give_feedback: 'Sharing an opinion, praise, or a complaint without asking for anything.' } },
  has_repro_steps: { type: 'noul', instructions: 'Does the message include concrete steps that would let someone reproduce the problem?' },
  security_concern: { type: 'noul', instructions: 'Does the message describe unauthorized access, or a change to the account that the customer did not make?' },
  sarcasm: { type: 'noul', instructions: 'Is the customer being sarcastic?' },
  product_area: { type: 'choice', instructions: 'Which part of the product is this about?', criteria: {
    payouts: 'Sending money out to bank accounts or contractors.', invoices: 'Creating, sending, exporting, or formatting invoices.',
    login: 'Signing in, passwords, two-factor codes.', api: 'API keys, webhooks, integrations.',
    subscription: 'The customer\'s own plan and what they pay for the service.', other: 'None of these, or not clear.' } },
  legal_threat: { type: 'noul', instructions: 'Does the customer mention lawyers, regulators, or filing a chargeback?' },
  wants_human: { type: 'noul', instructions: 'Does the customer explicitly ask to speak with a person or to get a call?' },
};

const order = ['department', 'frustration', 'refund_requested', 'urgency', 'churn_risk', 'intent', 'has_repro_steps', 'security_concern', 'sarcasm', 'product_area', 'legal_threat', 'wants_human'];
export const questionSets = {
  triage1: order.slice(0, 1), triage3: order.slice(0, 3), triage6: order.slice(0, 6), triage12: order.slice(0, 12),
};
export const questionsFor = (setIdOrIds) => Object.fromEntries((Array.isArray(setIdOrIds) ? setIdOrIds : questionSets[setIdOrIds]).map((id) => [id, questionBank[id]]));

// A long, messy, forwarded thread. The real issue is buried: someone changed the payout bank account.
const log = Array.from({ length: 46 }, (_, i) => {
  const mm = String(7 + Math.floor(i / 4)).padStart(2, '0'), ss = String((i * 13) % 60).padStart(2, '0');
  const ev = ['invoice.created', 'invoice.sent', 'invoice.viewed', 'payout.scheduled', 'invoice.paid', 'contact.updated'][i % 6];
  return `2026-09-02T09:${mm}:${ss}Z  webhook  ${ev.padEnd(17)} 200  evt_${(48210 + i * 37).toString(16)}  ${12 + (i * 7) % 90}ms`;
}).join('\n');
const longThread = `Fwd: Fwd: RE: RE: quick question about our account (sorry for the long thread)

Hi Ledgerly team,

Forwarding this whole chain because I honestly am not sure who should see it. I'm the office manager at Harbourline Studio and I took over our Ledgerly account from Priya when she went on leave in August, so apologies if some of this is old news. I've left everything below so you have the context.

A few small things first. We still haven't received the printed welcome pack that was mentioned when we signed up, not that it matters much. Also our studio moved in July so the postal address on our profile is out of date, I'll fix that myself when I find the setting. And Marcus asked whether the mobile app has a dark mode yet, he keeps asking me, so I'm passing it on.

Now the actual reason I'm writing. While I was going through the settings to update our address I opened the Payouts page and the bank account listed there ends in 4471. Our business account ends in 9023 and always has. I asked Priya by text and she says she never touched it. I asked Marcus and Dele and neither of them even has admin rights. The activity panel says "Payout destination updated" on 2 September at 09:14, and the user shown is just "owner", which is the shared login we all used before you added team seats. Nobody here did this. We have a payout of a little over eleven thousand dollars scheduled for Friday for our contractors and I do not want it going to an account we don't know.

I pasted our webhook log from that morning below in case it helps, I don't really know how to read it but our developer said you might want it.

${log}

I also don't know if this is related, but on the same day two of us got "new sign-in from Windows device" emails and we are all on Macs here. I assumed it was a glitch at the time.

Can someone please lock the payout or whatever you need to do, and tell me how to check who has access? I'm in the office until 6pm and can take a call, otherwise email is fine.

Thanks so much,
Renata Okafor
Office Manager, Harbourline Studio
Unit 4, The Boatworks, 18 Quay Lane

This email and any attachments are confidential and intended solely for the addressee. If you have received this message in error please notify the sender and delete it. Harbourline Studio Ltd accepts no liability for any damage caused by any virus transmitted by this email. Please consider the environment before printing.

---------- Forwarded message ----------
From: Priya Raman
Subject: RE: RE: quick question about our account

Renata, I definitely didn't change any bank details. The last thing I did in Ledgerly was send the July invoices. The only other thing I remember is the renewal reminder, we are on the Team plan billed annually and it renews in November, I think the price went up a little but I was fine with it. Hope the handover notes are useful. Back on the 29th.

---------- Forwarded message ----------
From: Marcus Bell
Subject: RE: quick question about our account

Not me. I can't even see that page. While you have them on the line can you ask about dark mode on the app, and whether invoice templates can use our new logo? The old one is still on the PDF footer. No rush on that.

---------- Forwarded message ----------
From: Dele Adeyemi
Subject: quick question about our account

I only log in to download my remittance slips. Didn't change anything. By the way the remittance PDF for August had the right amount, so no complaints from me.`;

export const inputs = {
  t01: { tier: 'clear', title: 'Duplicate charge', state: 'I was charged twice for my March subscription. There are two identical charges of $49 on the 3rd. Please refund the duplicate.',
    labels: { department: 'billing', refund_requested: true } },
  t02: { tier: 'clear', title: 'Export button error', state: "The CSV export on the Invoices page has thrown a 500 error every time since yesterday's update. Steps: open Invoices, click Export, choose CSV. Chrome 126 on macOS. Other exports work.",
    labels: { department: 'technical', refund_requested: false } },
  t03: { tier: 'clear', title: 'Password reset never arrives', state: "I can't log in. The password reset email never arrives, I've checked spam and tried three times. My login is dana@harbourline.example.",
    labels: { department: 'account', refund_requested: false } },
  t04: { tier: 'clear', title: 'Quote for an agency', state: "We're a 40-person agency looking at your Team plan. Do you offer annual discounts, and can someone send us a quote?",
    labels: { department: 'sales', refund_requested: false } },
  t05: { tier: 'clear', title: 'Praise for the dashboard', state: 'Just wanted to say the new dashboard looks great. Nice work to whoever designed it.',
    labels: { department: 'other', refund_requested: false } },

  t06: { tier: 'borderline', title: 'Failed payout, restricted account', state: "My payout failed again and now my account says 'restricted'. Is this a bug on your side or did my bank reject it? I need to pay my contractors this week.",
    labels: { department: ['billing', 'technical', 'account'] }, note: 'Three teams could reasonably own this.' },
  t07: { tier: 'borderline', title: 'Paid for Pro, still on Free', state: "I upgraded to Pro yesterday and the payment went through, but I'm still seeing the Free plan limits. Can you sort this out?",
    labels: { department: ['billing', 'technical'] }, note: 'A payment that did not unlock the plan: billing or a bug.' },
  t08: { tier: 'borderline', title: 'Negation: NOT a refund', state: "To be clear, I am NOT asking for a refund. I just need the April invoice PDF to show our VAT number. It's missing, and our accountant won't accept it without one.",
    labels: { department: 'billing', refund_requested: false }, note: 'Tests negation. The word refund appears, but no refund is wanted.' },
  t09: { tier: 'borderline', title: 'Sarcasm during an outage', state: "Oh great, another 'scheduled maintenance' right at month-end payroll. Love that for us. Payouts have been stuck in pending for 200 contractors since this morning.",
    labels: { department: 'technical', refund_requested: false }, note: 'Tests sarcasm. Praise words, angry customer.' },

  t10: { tier: 'hard', title: 'Two requests in one', state: "Two things. The API returns 401 with a key that worked fine last week. Separately, I'd like to move us from monthly to annual billing.",
    labels: { department: ['technical', 'billing', 'sales'] }, escalateIsCorrect: true, note: 'Two intents. No single team is right, so sending it to a person is the correct outcome.' },
  t11: { tier: 'hard', title: 'Almost no information', state: "It's not working. Please fix asap.",
    labels: { department: ['technical', 'other'] }, escalateIsCorrect: true, note: 'Too vague to route. Sending it to a person is the correct outcome.' },
  t12: { tier: 'hard', title: 'Long forwarded thread', state: longThread,
    labels: { department: 'account', refund_requested: false }, note: 'A long forwarded thread with a welcome pack, dark mode, logos and a pasted log. The real issue is buried: a payout bank account that nobody changed.' },
  t13: { tier: 'hard', title: 'Unrecognised bank account', state: "There's a $900 payout going to a bank account I don't recognise. I never added that account. What is going on?",
    labels: { department: ['account', 'billing'] }, note: 'Looks like billing, but it is a security problem.' },
  t14: { tier: 'hard', title: 'Spanish-language request', state: 'Hola, necesito la factura de abril con el NIF correcto. La que recibí tiene el número antiguo. Gracias.',
    labels: { department: 'billing', refund_requested: false }, note: 'TypeSafe says Jev works best in English and is less accurate in other languages.' },
};

// "When not to use Jev": three cases taken from the vendor's own list of limitations.
// Ground truth is computed by code, which is the vendor's recommendation for these.
const charges = [189.99, 245.5, 89.0];
const purchase = new Date('2026-03-14T00:00:00Z'), today = new Date('2026-04-15T00:00:00Z');
const daysSince = Math.round((today - purchase) / 86_400_000);
export const limits = {
  counting: { limitation: 'Counting', vendorDocUrl: 'https://docs.typesafe.ai/model-jaggedness/jev-1.13',
    state: 'Please resend these invoices, the PDFs were corrupted: INV-2041, INV-2044, INV-2052 and INV-2057. Also INV-2044 had the wrong date the first time.',
    questions: { invoice_count: { type: 'choice', instructions: 'How many different invoice numbers does the message mention?', criteria: { one: null, two: null, three: null, four: null, five_or_more: null } } },
    truth: { invoice_count: 'four' }, truthBy: 'new Set(text.match(/INV-\\d+/g)).size = 4' },
  dates: { limitation: 'Date arithmetic', vendorDocUrl: 'https://docs.typesafe.ai/model-jaggedness/jev-1.13',
    state: { today: '15 April 2026', purchase_date: '14 March 2026', policy: 'Refunds are available within 30 days of purchase.', message: 'I would like to return this, am I still in time?' },
    questions: { within_window: { type: 'noul', instructions: 'Is the purchase still inside the refund window today?' } },
    truth: { within_window: daysSince <= 30 }, truthBy: `${daysSince} days have passed, and the window is 30` },
  math: { limitation: 'Arithmetic', vendorDocUrl: 'https://docs.typesafe.ai/model-jaggedness/jev-1.13',
    state: `I am disputing three charges: $${charges[0]}, $${charges[1].toFixed(2)} and $${charges[2].toFixed(2)}. Disputes over $500 need a manager, so tell me if I need one.`,
    questions: { over_500: { type: 'noul', instructions: 'Do the disputed charges add up to more than $500?' } },
    truth: { over_500: charges.reduce((a, b) => a + b, 0) > 500 }, truthBy: `the charges add up to $${charges.reduce((a, b) => a + b, 0).toFixed(2)}` },
};

export const featured = { anatomy: 't09', race: ['t01', 't09', 't12'], fanout: 't06' };

export const scenarioHash = createHash('sha256').update(JSON.stringify({ questionBank, questionSets, inputs, limits })).digest('hex').slice(0, 16);
