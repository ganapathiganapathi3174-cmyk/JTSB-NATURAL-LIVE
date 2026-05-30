<<<<<<< HEAD
# Frontend-Only Paid Community Platform

This is a **frontend-only** version of the paid community platform that runs entirely in the browser using `localStorage` for data storage. No backend server or database required!
=======
# Paid Community Platform - Frontend Only

**₹120 UPI payment** → admin (or mock) verification → **registration** with optional **referral codes**, **JWT** auth, and an **admin** panel for users and payments.

**🎯 Zero backend required!** Everything runs in the browser using localStorage.

## Stack

- **Frontend:** React 18, Vite, React Router
- **Database:** localStorage (browser storage)
- **Cryptography:** Web Crypto API (SHA-256, HMAC-SHA256)
- **QR Code:** qrcode library

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- No MongoDB needed!
- No backend server needed!
>>>>>>> 8faccc12bfa476a357c0044fe7b5bd178242cc6d

## Features

✅ **Complete payment flow** - QR code generation, payment submission, status tracking  
✅ **User authentication** - Registration, login, JWT tokens (browser-compatible)  
✅ **Admin panel** - Approve/reject payments, manage users, view dashboard stats  
✅ **Referral system** - Generate referral codes, track referrals  
✅ **Dark theme UI** - Beautiful, responsive design  
✅ **Zero backend dependencies** - Everything runs in the browser  

<<<<<<< HEAD
## How It Works

Instead of calling a backend API, this version:
- Stores all data (users, payments, admins) in `localStorage`
- Uses browser-compatible JWT signing/verification (Web Crypto API)
- Uses SHA-256 for password hashing (Web Crypto API)
- Intercepts all API calls and routes them to local controllers
- Mimics the exact same logic as the backend version

## Setup
=======
## Quick Start
>>>>>>> 8faccc12bfa476a357c0044fe7b5bd178242cc6d

```bash
cd frontend
npm install
npm run dev
```

<<<<<<< HEAD
The app will start at `http://localhost:5173`

## Default Admin Credentials

- **Email:** `jagan@gmail.com`
- **Password:** `jagan7523`
=======
App: `http://localhost:5173`

**Default Admin:**
- Email: `jagan@gmail.com`
- Password: `jagan7523`

## End-to-end flow

1. User opens **Payment**, scans UPI QR (config from `VITE_UPI_VPA` / `VITE_UPI_PAYEE_NAME`), pays ₹120, submits **UPI Reference Number**.
2. **Admin** logs in at `/admin`, opens **Payments**, and **approves** the payment.
3. User **registers** with the same **email + UPI Reference Number**.
4. User **logs in** and sees the **dashboard** (platform member count, referral stats, link).

## Pages

| Route | Description |
|-------|-------------|
| `/` | Redirects to `/payment` |
| `/payment` | Payment page with QR code and form |
| `/payment/pending?utr=xxx` | Check payment status |
| `/register` | User registration (after payment approved) |
| `/login` | Member login |
| `/dashboard` | Member dashboard (protected) |
| `/admin` | Admin login |
| `/admin/dashboard` | Admin dashboard (protected) |
| `/admin/users` | User management |
| `/admin/payments` | Payment approval/rejection |

## Environment Variables (Optional)

Copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_JWT_SECRET=your-secret-key-here
VITE_ADMIN_JWT_SECRET=your-admin-secret-key-here
VITE_PAYMENT_AMOUNT=120
VITE_UPI_VPA=merchant@upi
VITE_UPI_PAYEE_NAME=Community
```
>>>>>>> 8faccc12bfa476a357c0044fe7b5bd178242cc6d

## Data Storage

All data is stored in your browser's `localStorage`:
- `pc_db_users` - User accounts
- `pc_db_payments` - Payment submissions
- `pc_db_admins` - Admin accounts
- `pc_user_token` - User authentication token
- `pc_admin_token` - Admin authentication token

**Note:** Clearing your browser data will delete all users, payments, and admin accounts.

<<<<<<< HEAD
## Environment Variables (Optional)

Copy `.env.example` to `.env` and customize:

```env
VITE_JWT_SECRET=your-secret-key-here
VITE_ADMIN_JWT_SECRET=your-admin-secret-key-here
VITE_PAYMENT_AMOUNT=120
VITE_UPI_VPA=merchant@upi
VITE_UPI_PAYEE_NAME=Community
```

=======
>>>>>>> 8faccc12bfa476a357c0044fe7b5bd178242cc6d
## Architecture

```
frontend/src/
├── api/
│   └── client.js          # API interceptor (routes to controllers)
├── controllers/
│   ├── authController.js  # Registration, login, me
│   ├── paymentController.js # Payment config, submit, status
│   └── adminController.js # Admin login, users, payments, stats
├── db/
│   └── index.js           # localStorage database layer (replaces MongoDB)
├── utils/
│   └── jwt.js             # Browser-compatible JWT utility
├── context/
│   └── AuthContext.jsx    # User authentication context
<<<<<<< HEAD
├── pages/                 # All page components (unchanged logic)
└── App.jsx                # Route definitions
```

## Key Differences from Full-Stack Version

| Feature | Full-Stack | Frontend-Only |
|---------|-----------|---------------|
| Database | MongoDB | localStorage |
| Password Hashing | bcryptjs | SHA-256 (Web Crypto) |
| JWT | jsonwebtoken | Custom (Web Crypto) |
| File Uploads | Multer → disk | File → base64 data URL |
| Server | Node.js/Express | None (pure frontend) |
| Deployment | Backend + Frontend | Frontend only (Netlify, Vercel, etc.) |

## Building for Production

```bash
npm run build
```

The built files will be in `dist/` - deploy to any static hosting service (Netlify, Vercel, GitHub Pages, etc.)

## Limitations

- **Data is browser-specific** - Not shared across devices/browsers
- **No persistence across browsers** - Each browser has its own data
- **Storage limits** - localStorage has ~5-10MB limit (sufficient for hundreds of users)
- **Security** - Password hashing uses SHA-256 (good for demo, use bcrypt for production)

## Use Cases

✅ Perfect for **demos and prototypes**  
✅ Great for **small communities** (single admin, <100 users)  
✅ Excellent for **learning** how the platform works  
✅ Ideal for **development** without setting up a backend  

## Migration to Full-Stack

If you need to scale up:
1. Set up the backend from the parent directory
2. Export localStorage data
3. Import into MongoDB
4. Deploy both frontend and backend

## License

Same as the parent project.
=======
├── pages/                 # All page components
└── App.jsx                # Route definitions
```

## How It Works

Instead of calling a backend API, this version:
- Stores all data (users, payments, admins) in `localStorage`
- Uses browser-compatible JWT signing/verification (Web Crypto API)
- Uses SHA-256 for password hashing (Web Crypto API)
- Intercepts all API calls and routes them to local controllers
- Mimics the exact same logic as a backend version

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment guides for:
- Netlify
- Vercel
- GitHub Pages
- Render (Static Site)

## Security notes

- Use **strong** `VITE_JWT_SECRET` and `VITE_ADMIN_JWT_SECRET` in production.
- Replace UPI details with your real **VPA**.
- Password hashing uses SHA-256 (good for demo, use bcrypt for production backend).

## Project layout

```
paid-community-platform/
├── .gitignore
├── DEPLOYMENT.md
├── README.md
├── render.yaml
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── netlify.toml
    ├── README.md
    └── src/
        ├── api/client.js
        ├── context/AuthContext.jsx
        ├── controllers/
        ├── db/
        ├── pages/
        └── utils/
```

## License

MIT
>>>>>>> 8faccc12bfa476a357c0044fe7b5bd178242cc6d
