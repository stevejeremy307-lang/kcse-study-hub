# KCSE Study Hub — full-stack starter

A responsive revision platform starter with:
- Student accounts using email + phone (prototype sign-in; see security notes)
- SQLite database for users, papers, and payment records
- Admin sign-in, PDF upload, VIP-only paper marking, and delete controls
- KSh 500 VIP membership
- Safaricom Daraja STK Push integration hooks and payment callback
- VIP is activated only after a successful callback whose amount and phone match the account

## Educational/legal boundary
This is an independent revision platform, not a KNEC website. Only upload papers, marking schemes, and notes you own or are authorised to distribute. Do not upload leaked, confidential, or unreleased examination papers. Do not use official KNEC branding in a way that suggests endorsement.

## Run locally
1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env`.
3. Change `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. In this folder run:
   ```bash
   npm install
   npm start
   ```
5. Open `http://localhost:3000`.

The database `studyhub.sqlite` is created automatically. PDF uploads are stored in `uploads/`.

## Before public launch — required
This is a starter, not a security-audited production system. Do not deploy as-is for real users or money. In particular:
- Add OTP verification for student phone/email ownership; currently the email+phone form is not proof of identity.
- Add login/admin rate limiting, CSRF protection, password hashing or a verified passwordless flow, and a persistent production session store.
- Use HTTPS, secure deployment secrets, backups, monitoring, malware scanning for uploads, and database/file permissions.
- Review Kenya Data Protection Act obligations; publish a privacy notice, terms, retention/deletion procedure, contact details, and refund policy.
- Have the Daraja merchant account, shortcode, passkey, credentials, and public HTTPS callback configured by the account owner. Test in Safaricom sandbox before production.
- Validate callback authenticity according to Safaricom's current guidance and reconcile transactions server-side. The included callback checks amount and phone but needs additional production-grade verification and reconciliation.
- Configure reverse proxy and `NODE_ENV=production` so secure cookies work.
- Consider rate limiting, file access auditing, backups, accessibility, and a proper support workflow.

## M-Pesa setup overview
1. Create/configure an application in Safaricom Daraja and start in sandbox.
2. Set `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, and `MPESA_CALLBACK_URL` in `.env`.
3. Deploy behind HTTPS so Safaricom can reach `/api/mpesa/callback`.
4. Confirm STK push and callback handling in sandbox before enabling real payments.
5. Use a merchant account and clearly identify the business/recipient to the payer. Never hide the payment recipient from the user before they approve the payment.

## Admin
Admin credentials come from `.env`. Change the sample values immediately. Admin URL is the Administrator section on the home page.


## Selected launch preferences
- Public-facing name: **KCSE Study Hub**
- VIP payment methods: **M-Pesa STK Push + manual payment**
- Hosting preference: **free hosting**, if compatible with a persistent Node.js app and database

### Manual payment note
The starter currently implements the Daraja STK Push route. A manual payment flow should not activate VIP from a screenshot or a browser form alone. For a safe manual workflow, add a pending payment request, provide clear merchant/recipient details before payment, then let an administrator reconcile the transaction against the actual M-Pesa statement or merchant confirmation before activating VIP. Do not hide the recipient from the payer before they approve a payment.

### Free hosting caveat
Many free web hosts sleep apps, restrict persistent disks, or do not support SQLite persistence. Choose a host that supports Node.js and persistent storage, or move the database to a managed PostgreSQL service. Do not assume local SQLite data and uploaded files will persist on ephemeral hosting.
