#!/usr/bin/env node
// Boxed Indulgence -- send any of the real email templates through Resend
// without going through an actual booking, contact form, or lunch-sale
// order. Imports the exact same template functions src/index.js calls, so
// this always reflects the real templates (including the branded shell
// and the "Day, Month Date Year" date formatting).
//
// This sends a REAL email via the REAL Resend API -- it isn't a dry run.
//
// Usage:
//   RESEND_API_KEY=re_xxx node scripts/send-test-email.js list
//   RESEND_API_KEY=re_xxx node scripts/send-test-email.js <template> you@example.com
//
// RESEND_API_KEY is the same secret set via `wrangler secret put RESEND_API_KEY`
// -- grab it from the Resend dashboard (API Keys) if you don't have it handy.
// BUSINESS_NAME/SITE_URL/FROM_EMAIL/DEPOSIT_LINK_EXPIRY_HOURS default to the
// values in wrangler.jsonc; override any of them as env vars if needed.

import {
  sendEmail,
  formatDate,
  bookingRequestEmailToClient,
  bookingReceivedEmailToCustomer,
  bookingApprovedEmailToCustomer,
  bookingRejectedEmailToCustomer,
  bookingCanceledEmailToCustomer,
  depositConfirmedEmail,
  contactMessageEmailToClient,
  lunchSaleOrderReceivedEmailToClient,
  lunchSaleOrderConfirmedEmail,
  lunchSalePaymentLinkEmail,
  lunchSaleSignupConfirmedEmail,
  lunchSaleNowLiveEmail,
  depositPaidAdminNotice,
  lunchOrderPaidAdminNotice,
} from '../src/lib/email.js';

const env = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  BUSINESS_NAME: process.env.BUSINESS_NAME || 'Boxed Indulgence',
  SITE_URL: process.env.SITE_URL || 'https://boxedindulgence.com',
  FROM_EMAIL: process.env.FROM_EMAIL || 'bookings@boxedindulgence.com',
  DEPOSIT_LINK_EXPIRY_HOURS: process.env.DEPOSIT_LINK_EXPIRY_HOURS || '72',
};

// Edit these to try different names/dates/amounts/etc.
const mock = {
  booking: {
    name: 'Jordan Rivera',
    email: 'jordan.rivera@example.com',
    phone: '(336) 555-0142',
    event_type: 'corporate',
    event_date: '2026-09-19',
    guest_count: 25,
    location: '123 Main St, Greensboro, NC',
    budget: '$1,500–$2,000',
    notes: 'Please include vegetarian options for 5 guests.',
    order_items: [
      { item_name: 'Signature Sandwich Box', quantity: 20, line_total_cents: 48000 },
      { item_name: 'Seasonal Salad Box', quantity: 5, line_total_cents: 11000 },
    ],
    order_total_cents: 59000,
    deposit_percent: 50,
    deposit_amount_cents: 29500,
  },
  checkoutPageUrl: 'https://boxedindulgence.com/booking/checkout/?booking=TEST123',
  msg: {
    name: 'Taylor Reed',
    email: 'taylor.reed@example.com',
    phone: '(336) 555-0199',
    guest_count: 15,
    event_date: '2026-10-03',
    location: 'Greensboro, NC',
    budget: '$800',
    message: 'Hi, I would love a quote for a small birthday gathering.',
  },
  order: {
    name: 'Alex Chen',
    email: 'alex.chen@example.com',
    phone: '(336) 555-0177',
    quantity: 3,
    dropoff_choice: '12:00 PM — Downtown Office Park',
    total_cents: 7200,
  },
  event: {
    title: 'Friday Lunch Sale',
    menu_description: 'Signature sandwiches, seasonal sides, and dessert.',
    price_cents: 2400,
    order_cutoff_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  confirmed: { name: 'Jordan Rivera', event_date: '2026-09-19' },
  paidOrder: {
    name: 'Alex Chen',
    quantity: 3,
    total_cents: 7200,
    dropoff_choice: '12:00 PM — Downtown Office Park',
  },
};

const TEMPLATES = {
  'booking-request-admin': {
    subject: `New booking request — ${formatDate(mock.booking.event_date)}`,
    html: () => bookingRequestEmailToClient(env, mock.booking),
  },
  'booking-received': {
    subject: `We received your request — ${env.BUSINESS_NAME}`,
    html: () => bookingReceivedEmailToCustomer(env, mock.booking),
  },
  'booking-approved': {
    subject: `You're approved for ${formatDate(mock.booking.event_date)}! Next step: deposit`,
    html: () => bookingApprovedEmailToCustomer(env, mock.booking, mock.checkoutPageUrl),
  },
  'booking-rejected': {
    subject: `Update on your request for ${formatDate(mock.booking.event_date)}`,
    html: () => bookingRejectedEmailToCustomer(env, mock.booking),
  },
  'booking-canceled': {
    subject: `Your request for ${formatDate(mock.booking.event_date)} has been canceled`,
    html: () => bookingCanceledEmailToCustomer(env, mock.booking),
  },
  'deposit-confirmed': {
    subject: `Deposit received — ${formatDate(mock.booking.event_date)} is booked!`,
    html: () => depositConfirmedEmail(env, mock.booking),
  },
  'contact-message-admin': {
    subject: `New contact form message from ${mock.msg.name}`,
    html: () => contactMessageEmailToClient(env, mock.msg),
  },
  'lunch-order-received-admin': {
    subject: `New lunch-sale order — ${mock.event.title}`,
    html: () => lunchSaleOrderReceivedEmailToClient(env, mock.order, mock.event),
  },
  'lunch-order-confirmed': {
    subject: `Order confirmed — ${mock.event.title}`,
    html: () => lunchSaleOrderConfirmedEmail(env, mock.order, mock.event),
  },
  'lunch-payment-link': {
    subject: `Your payment link — ${mock.event.title}`,
    html: () => lunchSalePaymentLinkEmail(env, mock.order, mock.event, mock.checkoutPageUrl),
  },
  'lunch-signup-confirmed': {
    subject: `You're on the list — ${env.BUSINESS_NAME}`,
    html: () => lunchSaleSignupConfirmedEmail(env),
  },
  'lunch-now-live': {
    subject: `${mock.event.title} is open!`,
    html: () => lunchSaleNowLiveEmail(env, mock.event),
  },
  'deposit-paid-admin-notice': {
    subject: `Deposit paid — ${formatDate(mock.confirmed.event_date)} (${mock.confirmed.name})`,
    html: () => depositPaidAdminNotice(env, mock.confirmed),
  },
  'lunch-order-paid-admin-notice': {
    subject: `Lunch order paid — ${mock.event.title} (${mock.paidOrder.name})`,
    html: () => lunchOrderPaidAdminNotice(env, mock.paidOrder, mock.event),
  },
};

function printUsage() {
  console.log('Available templates:\n');
  for (const name of Object.keys(TEMPLATES)) console.log(`  ${name}`);
  console.log('\nUsage:');
  console.log('  RESEND_API_KEY=re_xxx node scripts/send-test-email.js <template> you@example.com');
}

const [, , templateName, to] = process.argv;

if (!templateName || templateName === 'list' || !TEMPLATES[templateName]) {
  if (templateName && templateName !== 'list') {
    console.error(`Unknown template "${templateName}".\n`);
  }
  printUsage();
  process.exit(templateName && templateName !== 'list' ? 1 : 0);
}

if (!to) {
  console.error('Missing recipient email address.\n');
  printUsage();
  process.exit(1);
}

if (!env.RESEND_API_KEY) {
  console.error(
    'Missing RESEND_API_KEY. Run with:\n' +
      '  RESEND_API_KEY=re_xxx node scripts/send-test-email.js ' +
      `${templateName} ${to}`
  );
  process.exit(1);
}

const { subject, html } = TEMPLATES[templateName];

try {
  await sendEmail(env, { to, subject, html: html() });
  console.log(`Sent "${templateName}" (${subject}) to ${to}.`);
} catch (err) {
  console.error(`Failed to send: ${err.message}`);
  process.exit(1);
}
