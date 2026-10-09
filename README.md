# Cloud Uko CRM

Single-user CRM that runs on your own PC: clients, projects, follow-up tasks, quotes, invoices (ZAR, PDF),
payments and recurring billing.

- **Stack:** Node.js 22+, Express 5, EJS, libsql (a local SQLite file, same engine as Turso), PDFKit.
- **Data:** everything lives in `data/` (`crm.db`). That folder is in `.gitignore` because it holds client
  personal information (POPIA). Never commit it or share it.

## Run it

```
npm install
npm start
```

Or double-click `start-crm.bat`. Then open <http://localhost:3000>.

On the first visit you are asked to create your login (username and a password of at least 10 characters).
After that the setup page is closed. Change the password under **Settings**.

Keep the window open while you use the CRM; closing it stops the server.

## Settings to fill in before your first real invoice

Under **Settings**: business address and contact details, VAT (registered or not, number, rate),
banking details, payment terms and the invoice/quote number prefixes.

To put your logo on PDFs, save it as `data/logo.png` (or `logo.jpg`).

## How billing works

- Quotes and invoices are numbered per year: `CU-INV-2026-001`, `CU-QUO-2026-001`.
- A new invoice starts as a **draft**. **Mark as sent** makes it count as billed and unlocks payments.
- Payments are recorded against an invoice, so part-payments show as *Part-paid* with the balance outstanding.
- A sent invoice is locked. To change it, move it back to draft (only possible while it has no payments).
- **Recurring billing** holds monthly and yearly services. *Invoice now* (or *Create invoices for due*) creates
  a draft invoice for the next period and moves the next billing date on.
- VAT is only added when "VAT registered" is ticked in Settings. Existing documents keep the rate they were
  created with.

## Use it from your phone, anywhere (Tailscale)

The CRM is not exposed to the internet. Tailscale puts your PC and phone on a private network that only
your own devices can join.

1. Install Tailscale on this PC and on your phone from <https://tailscale.com/download>, and sign in to the
   same account on both.
2. Start the CRM. The startup output lists the addresses it is reachable on, including the Tailscale one
   (it starts with `100.`).
3. On your phone, with Tailscale switched on, open `http://<that 100.x address>:3000`.
4. The first time, Windows Firewall asks whether to allow Node.js. Allow it on private networks.

The PC has to be on and the CRM running. Traffic between your devices is encrypted by Tailscale.
On the same Wi-Fi you can also use the PC's local address, which is listed at startup too.

## Backups

```
npm run backup
```

Writes a snapshot to `data/backups/crm-<date>-<time>.db`. Copy it to somewhere off this PC (it contains
client personal information, so keep it private). To restore, stop the CRM and replace `data/crm.db` with
the backup file.

## Environment variables

All optional. Copy `.env.example` to `.env` to change them.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | `0.0.0.0` allows other devices (Wi-Fi, Tailscale); `127.0.0.1` is this PC only |
| `DATA_DIR` | `./data` | Folder for the database, backups, logo and session secret |
| `DATABASE_URL` | local file | Set to a `libsql://` URL to use Turso instead of the local file |
| `DATABASE_AUTH_TOKEN` | none | Turso auth token, used with `DATABASE_URL` |
| `SESSION_SECRET` | generated | Generated into `data/.session-secret` on first start if not set |

## Importing starting data

`npm run import-seed` loads `data/seed.json` (clients, projects, invoices, payments, recurring services).
It only runs on an empty database, so it cannot duplicate or overwrite existing data.

## Project layout

```
src/server.js            app setup, security headers, sessions, CSRF, auth guard
src/schema.sql           database tables (applied on every start, safe to re-run)
src/routes/              one file per section; documents.js serves both quotes and invoices
src/services/documents.js numbering, totals, recurring invoice generation
src/pdf.js               quote / invoice PDF layout
views/, public/          EJS pages, CSS and the small front-end script
scripts/                 backup and seed import
```
