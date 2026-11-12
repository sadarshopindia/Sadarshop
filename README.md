# Sadarshop — Wholesale Fabrics & Textiles

A self-hosted, lightweight online catalog and B2B wholesale enquiry platform for **Sadarshop**.

- **Zero Runtime Dependencies**: Uses Node.js native built-in modules (`node:sqlite`, `node:http`, `node:crypto`). No heavy `npm install` needed to run the website.
- **Fast & Self-Contained**: The database is a single SQLite file (`data/sadarshop.db`), and all product assets are bundled locally.

---

## Quick Start (How to Run Locally)

### 1. Requirement
Install **Node.js (v22.5.0 or newer)** from [nodejs.org](https://nodejs.org). That is the **only** prerequisite.

### 2. Start the site

#### Windows
Double-click **`start.bat`**.
*This launches the server and opens your browser automatically.*

#### macOS
Double-click **`start.command`**.
*(Or run `bash start.command` in terminal).*

#### From Any Terminal (Windows / Mac / Linux)
```bash
npm start
```
Then open:
- **Storefront**: [http://localhost:3000](http://localhost:3000)
- **Admin Panel**: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## Admin Credentials

| | |
|---|---|
| **Admin Panel** | [http://localhost:3000/admin](http://localhost:3000/admin) |
| **Email** | `admin@example.com` |
| **Password** | `admin123` |

To reset the admin credentials anytime, run:
```bash
npm run reset-admin
```

---

## How to Share with Others

Anyone who receives this project can run it on their PC in under 1 minute.

### Option A: Share as a ZIP file (Recommended)
1. Zip the **`Sadarshop`** folder.
2. Ensure the ZIP includes:
   - All source code (`server.js`, `src/`, `views/`, `public/`)
   - The database file: `data/sadarshop.db`
   - The launchers: `start.bat`, `start.command`
   *(You do not need to include `node_modules` — keeping the zip under ~15 MB!)*
3. Send the zip file (via Google Drive, WeTransfer, Telegram, WhatsApp, email, etc.).
4. The recipient simply extracts the zip and double-clicks **`start.bat`** (Windows) or runs `npm start`.

### Option B: Share via Git / GitHub
1. Commit and push the project to GitHub:
   ```bash
   git add .
   git commit -m "Sadarshop ready to run"
   git push origin main
   ```
2. The recipient clones the repository and starts it:
   ```bash
   git clone <your-repository-url>
   cd Sadarshop
   npm start
   ```

---

## Key Features

- **Wholesale Catalog**: 79 textile and fabric products organized across categories.
- **Quotation & B2B Enquiry**: Customers can build an enquiry list and submit for direct wholesale quotation.
- **Multi-Image Support**: Products with multiple photography angles display dynamic carousels.
- **Admin Management**: Manage products, categories, enquiries, customer registrations, and site settings directly from `/admin`.

---

## Project Structure

```
Sadarshop/
├── server.js              Web server entry point
├── start.bat              One-click launcher for Windows
├── start.command          One-click launcher for macOS
├── package.json           Configuration & npm scripts
├── reset-password.js      Script to reset admin login
├── data/
│   └── sadarshop.db       Main SQLite database (contains all products & settings)
├── public/                Static assets (CSS, JS, logos, and product photos)
│   └── img/products/      Product image collection
├── src/                   Server backend logic, routing, and database helpers
└── views/                 EJS page templates (storefront, admin, accounts)
```
