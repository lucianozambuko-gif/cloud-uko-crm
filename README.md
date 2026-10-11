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

Then open <http://localhost:3000>.

On the first visit you are asked to create your login (username and a password of at least 10 characters).
After that the setup page is closed. Change the password under **Settings**.

### Desktop app

```
powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1
```

This puts a **Cloud Uko CRM** icon on the Desktop and in the Start menu. Opening it starts the server in the
background (no console window) if it is not already running, then opens the CRM in its own window.

- Closing the window does not stop the server, so phone access and automation keep working until the PC
  shuts down. To stop it, double-click `stop-crm.bat`.
- The server's output goes to `data/crm.log` and `data/crm-error.log`.
- Run the install command again if you move the project folder.

`start-crm.bat` still works if you prefer a visible console window; closing that window stops the server.

## Settings to fill in before your first real invoice

Under **Settings**: business address and contact details, VAT (registered or not, number, rate),
banking details, payment terms and the invoice/quote number prefixes.

To put your logo on PDFs, save it as `data/logo.png` (or `logo.jpg`).

## How billing works

- Quotes and invoices are numbered per year: `CU-INV-2026-001`, `CU-QUO-2026-001`.
- A new invoice starts as a **draft**. **Mark as sent** makes it count as billed and unlocks payments.
- Payments are recorded against an invoice, so part-payments show as *Part-paid* with the balance outstanding.
- A sent invoice is locked. To change it, move it back to draft (only possible while it has no payments).
- **Recurring billing** holds monthly and yearly services. They are invoiced automatically on their billing
  date (see Automation below). *Invoice now* still works if you want to bill early.
- VAT is only added when "VAT registered" is ticked in Settings. Existing documents keep the rate they were
  created with.

## Project life cycle

Every project moves through six stages: **Planning, Building, Demo ready, Client review, Final changes, Live**.
A project can also be paused or cancelled without losing its stage.

- **Two links.** The demo site link comes first; the live (production) link is filled in at go-live.
- **Checklist.** A new project starts with the standard checklist, grouped by stage. Tick steps off and the
  progress bar shows the share done. Without a checklist, progress follows the stage.
- **Moving on.** Tap a stage on the project page, or use the "Move to ..." button. When every step of the
  current stage is ticked you get a nudge to move on; nothing moves by itself.
- **Standard checklist.** Edit it under **Settings**, one step per line as `Stage name: step`. Changes apply
  to new projects only. Adding it to a project part-way through pre-ticks the stages already passed.
- **WhatsApp.** The project page has a button to send the client the demo link, and the live link once live.
- **Overview.** The Projects list and the Dashboard show each project's stage and progress.

## Automation

Checks run when the CRM starts and then every hour while it is open. If the PC was off, the next start
catches up (at most 12 missed periods per service). Each rule can be changed or switched off under
**Settings > Automation**, and the dashboard lists what was done.

| Rule | What happens | Default |
|---|---|---|
| Recurring service reaches its billing date | Invoice is created, plus a task to check and send it | Draft invoice |
| Yearly renewal is coming up | Task to confirm the price and tell the client | 30 days before |
| Invoice is overdue and unpaid | Task to chase payment, repeated while it stays unpaid | Every 7 days |
| Sent quote has had no answer | Task to follow up | After 7 days |
| Project has sat in Client review | Task to follow up on the demo | After 7 days |
| Project moves to Live | Task to set up hosting billing, unless it already has recurring billing | Always |

Automatic tasks are marked *Auto* and link to the invoice or quote. They tick themselves off when the
reason goes away: the draft is sent, the invoice is paid, the quote is accepted or declined.

Nothing is sent to clients automatically. The CRM prepares the work; you send it.

## WhatsApp messages

Quotes and invoices have WhatsApp buttons (new invoice, payment reminder, thank-you once paid, quote).
A button opens WhatsApp chatting to the client with the message already written, including the amount,
due date and your banking details. You press send, and attach the PDF yourself.

Edit the wording under **Settings > WhatsApp messages**. The client needs a phone number; local numbers
starting with 0 are treated as South African (+27).

## Use it from your phone, anywhere (Tailscale)

The CRM is not exposed to the internet. Tailscale puts your PC and phone on a private network that only
your own devices can join.

1. Install Tailscale on this PC and on your phone from <https://tailscale.com/download>, and sign in to the
   same account on both.
2. Start the CRM. The startup output lists the addresses it is reachable on, including the Tailscale one
   (it starts with `100.`).
3. On your phone, with Tailscale switched on, open `http://<that 100.x address>:3000`.
4. The first time, Windows Firewall asks whether to allow Node.js. Allow it on private networks.

### HTTPS and the phone app

Once HTTPS is enabled for your Tailscale account (admin console, DNS page, "HTTPS Certificates"), run:

```
tailscale serve --bg 3000
```

The CRM is then also at `https://<pc-name>.<your-tailnet>.ts.net`, only for your own devices. Tailscale
remembers this across restarts. To switch it off: `tailscale serve --https=443 off`.

To install it on the phone: open that `https` address in Chrome, tap the menu (three dots) and choose
**Add to Home screen** / **Install app**. Over HTTPS it opens full screen like an app, with the Cloud UKO
logo as its icon (from `public/manifest.webmanifest` and `public/icons/`). Added from a plain `http`
address it is only a bookmark that opens in Chrome.

### Start with Windows

```
powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1 -StartWithWindows
```

Starts the server in the background when you sign in to Windows, without opening a window, so the phone
can reach the CRM without you starting it. Use `-NoStartWithWindows` to undo it.

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
src/services/automation.js the hourly rules (recurring invoices, renewal, overdue and quote follow-ups)
src/lib/whatsapp.js      phone number handling and WhatsApp message templates
src/pdf.js               quote / invoice PDF layout
views/, public/          EJS pages, CSS and the small front-end script
scripts/                 backup and seed import
```
