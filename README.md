# RANG O RIWAJ — Storefront + Admin CMS

Needs Node.js 22.5 or newer. No packages to install.

## Start
    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=choose-a-strong-password node server.js

The admin account is created on first run from those two variables (the password is stored hashed with scrypt).
After the first run you can start with just `node server.js`. Change the password later in Admin Account.

- Store:  http://localhost:3000
- Admin:  http://localhost:3000/admin/login  (then /admin/dashboard)

## Where things live
- data/store.db  — products, settings, admin account (SQLite). Back this folder up.
- uploads/       — product images. Back this up too.
- public/        — index.html (storefront), admin.html (dashboard).

## Going live
Run behind HTTPS (Caddy, nginx, or your host's TLS) with NODE_ENV=production so the session cookie is Secure.
Hosting must keep the data/ and uploads/ folders between restarts (a VPS or a host with a persistent disk).
Static-only hosts and Framer cannot run this server.

## Security notes
Scrypt-hashed password, HttpOnly SameSite=Strict session cookie (8h), login rate limit (5 tries / 15 min),
custom-header check on every write, uploads checked by file signature. No credentials in frontend code.
Not included: 2FA, password-reset by email, multi-admin roles, image resizing.
