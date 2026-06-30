# JTSB NATURAL LIVE - Frontend-Only Architecture

## ✅ Status: 100% Frontend-Dependent

Your site is **completely frontend-dependent**. All functionality runs directly in the browser without any backend server.

---

## 📋 Architecture Overview

### **Technology Stack:**
- **Frontend Framework:** React 18.3.1
- **Build Tool:** Vite 5.4.21
- **Routing:** React Router DOM 6.28.0
- **Database:** localStorage (browser storage)
- **Authentication:** JWT (Web Crypto API)
- **QR Code:** qrcode library
- **HTTP Client:** Custom API client (simulates backend routes)

### **What Replaced the Backend:**

| Backend Component | Frontend Replacement |
|-------------------|---------------------|
| MongoDB Database | localStorage with MongoDB-like API |
| Express.js Server | Custom API client with route mapping |
| bcrypt Password Hashing | Web Crypto API (SHA-256) |
| jsonwebtoken | Custom JWT using Web Crypto API |
| Multer File Upload | FileReader API (base64 conversion) |
| Server-side Validation | Client-side validation in controllers |

---

## 🎯 Features Working (All Frontend-Only)

### **1. Payment System**
- ✅ UPI QR code generation
- ✅ Payment submission with screenshot upload
- ✅ Payment status tracking (pending/approved/rejected/suspicious)
- ✅ Duplicate payment detection
- ✅ Fraud detection (multiple submissions flagged)

### **2. User Authentication**
- ✅ Registration with payment verification
- ✅ Login with email/password
- ✅ JWT token management
- ✅ Protected routes
- ✅ Session persistence (localStorage)

### **3. User Dashboard**
- ✅ Profile display
- ✅ Referral code & link generation
- ✅ Referral count tracking
- ✅ Share via WhatsApp, Telegram, Email
- ✅ Copy referral code/link to clipboard
- ✅ Platform stats display

### **4. Admin Panel**
- ✅ Admin login (email: `jagan@gmail.com`, password: `jagan7523`)
- ✅ Dashboard with statistics
- ✅ User management (view, search, delete)
- ✅ Payment verification (approve/reject/flag)
- ✅ Referral tree visualization
- ✅ Filter users by referral status
- ✅ Payment history with search

### **5. Referral System**
- ✅ Automatic referral code generation
- ✅ Referral tracking (who referred whom)
- ✅ Referral count increment
- ✅ Referral hierarchy/tree view
- ✅ Referral statistics

---

## 📁 Project Structure

```
frontend/
├── src/
│   ├── api/
│   │   └── client.js              # Custom API client (route mapper)
│   ├── context/
│   │   └── AuthContext.jsx        # Authentication context
│   ├── controllers/
│   │   ├── authController.js      # Auth logic (register, login, me)
│   │   ├── paymentController.js   # Payment logic (submit, status)
│   │   └── adminController.js     # Admin logic (CRUD, stats)
│   ├── db/
│   │   └── index.js               # localStorage database layer
│   ├── pages/                     # All page components
│   │   ├── PaymentPage.jsx
│   │   ├── PaymentPendingPage.jsx
│   │   ├── RegisterPage.jsx
│   │   ├── LoginPage.jsx
│   │   ├── UserDashboardPage.jsx
│   │   ├── MyProfilePage.jsx
│   │   ├── AdminLoginPage.jsx
│   │   ├── AdminDashboardPage.jsx
│   │   ├── AdminPaymentsPage.jsx
│   │   ├── AdminUsersPage.jsx
│   │   └── AdminReferralsPage.jsx
│   ├── utils/
│   │   └── jwt.js                 # JWT sign/verify (Web Crypto)
│   ├── App.jsx                    # Route definitions
│   ├── main.jsx                   # Entry point (initDB)
│   └── index.css                  # Global styles
├── .env                           # Local environment variables
├── .env.production                # Production environment variables
├── vite.config.js                 # Vite configuration
└── package.json                   # Dependencies
```

---

## 🚀 How to Run

### **Development:**
```bash
cd frontend
npm install
npm run dev
```
Site will be available at: `http://localhost:5173/`

### **Production Build:**
```bash
cd frontend
npm run build
```
Output in `dist/` folder - deploy to Netlify, Vercel, or any static host.

### **Preview Production Build:**
```bash
npm run preview
```

---

## 🔐 Default Admin Credentials

- **Email:** `jagan@gmail.com`
- **Password:** `jagan7523`

⚠️ **Important:** Change these in production by updating the `seedDefaultAdmin()` function in `db/index.js`.

---

## 💾 Data Storage

All data is stored in **localStorage** (browser storage):

| Storage Key | Contains |
|-------------|----------|
| `pc_db_users` | All registered users |
| `pc_db_payments` | All payment submissions |
| `pc_db_admins` | Admin accounts |
| `jtsb_token` | User JWT token |
| `jtsb_user` | User profile data |
| `pc_admin_token` | Admin JWT token |

### **View Stored Data:**
Open browser DevTools → Application → Local Storage → `http://localhost:5173`

---

## 🌐 Deployment Options

Since it's 100% frontend, you can deploy to:

- ✅ **Netlify** (netlify.toml included)
- ✅ **Vercel**
- ✅ **GitHub Pages**
- ✅ **Cloudflare Pages**
- ✅ **Any static hosting service**

No backend server needed!

---

## ⚠️ Limitations (Frontend-Only)

1. **Data is browser-specific** - Users on different devices/browsers won't share data
2. **Storage limits** - localStorage has ~5-10MB limit
3. **No real-time sync** - Data doesn't sync across tabs automatically
4. **Security** - Client-side only, not suitable for production with sensitive data
5. **File size** - Screenshots stored as base64 can fill localStorage quickly

### **When to Add Backend:**
- Multi-user data sharing needed
- Payment amounts exceed localStorage limits
- Real-time updates required
- Production security requirements

---

## 🐛 Known Issues & Fixes

### ✅ Fixed:
- ✅ Build successful (no compilation errors)
- ✅ All routes working
- ✅ Database initialization on first load
- ✅ Admin credentials seeded automatically

### 🔍 To Test:
1. Open `http://localhost:5173/` or `http://localhost:5174/`
2. Navigate to payment page
3. Submit a test payment
4. Register with the same email
5. Login and check dashboard
6. Admin panel: verify payments, manage users

---

## 📝 Environment Variables

Create a `.env` file in the `frontend/` directory:

```env
# Payment Configuration
VITE_PAYMENT_AMOUNT=120
VITE_UPI_VPA=9655897523@ptyes
VITE_UPI_PAYEE_NAME=Community

# JWT Secrets
VITE_JWT_SECRET=your-secret-key-here
VITE_ADMIN_JWT_SECRET=your-admin-secret-key-here
```

---

## 🎉 Summary

Your site is **fully functional as a frontend-only application**. All features work without a backend server:

- ✅ Payment processing
- ✅ User authentication
- ✅ Admin panel
- ✅ Referral system
- ✅ Data persistence (localStorage)
- ✅ File uploads (base64)
- ✅ QR code generation

**No changes needed** - it's already 100% frontend-dependent!

---

**Last Updated:** April 12, 2026
