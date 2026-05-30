# API Documentation - Paid Community Platform

## Overview

This document describes all available API endpoints in the platform. The application uses a controller-based architecture where HTTP-like requests are routed to internal controller functions.

## Base URL

All endpoints are relative to the application's API client.

---

## Authentication Endpoints

### 1. Register User

**Endpoint:** `POST /auth/register`

**Description:** Registers a new user after payment verification.

**Request Body:**
```javascript
{
  name: "John Doe",              // Required: User's full name
  email: "john@example.com",     // Required: User's email (must be unique)
  password: "securepassword",    // Required: User's password (min 8 characters)
  utr: "UPI123456789",           // Required: UPI transaction reference number
  referralCode: "ABC12345"       // Optional: Referral code from another user
}
```

**Success Response (201):**
```javascript
{
  message: "Registration successful",
  token: "jwt_token_here",       // JWT token for authentication
  user: {
    _id: "user_id",
    name: "John Doe",
    email: "john@example.com",
    referralCode: "XYZ98765",    // Auto-generated unique referral code
    referredBy: "ABC12345",      // Null if no referral used
    referralsCount: 0,
    paymentApproved: true,
    createdAt: "2026-04-12T..."
  }
}
```

**Error Responses:**
- `400`: Invalid referral code
- `403`: Payment not approved/pending/rejected
- `409`: Email already exists

---

### 2. Login User

**Endpoint:** `POST /auth/login`

**Description:** Authenticates a user and returns JWT token.

**Request Body:**
```javascript
{
  email: "john@example.com",     // Required: User's email
  password: "securepassword"     // Required: User's password
}
```

**Success Response (200):**
```javascript
{
  token: "jwt_token_here",
  user: {
    _id: "user_id",
    name: "John Doe",
    email: "john@example.com",
    referralCode: "XYZ98765",
    referredBy: null,
    referralsCount: 5,
    paymentApproved: true,
    createdAt: "2026-04-12T..."
  }
}
```

**Error Responses:**
- `401`: Invalid email or password
- `403`: Payment not approved

---

### 3. Get Current User

**Endpoint:** `GET /auth/me`

**Description:** Returns current authenticated user data with platform stats.

**Authentication:** Required (User JWT token)

**Success Response (200):**
```javascript
{
  user: { /* user object */ },
  platformStats: {
    totalUsers: 150
  },
  referredByName: "Referrer Name"  // Name of user who referred them
}
```

---

## Payment Endpoints

### 4. Get Payment Config

**Endpoint:** `GET /payments/config`

**Description:** Returns payment configuration (amount, UPI details).

**Success Response (200):**
```javascript
{
  amount: 120,
  upi: {
    vpa: "jagan7523@okicici",
    name: "Community"
  }
}
```

---

### 5. Submit Payment

**Endpoint:** `POST /payments/submit`

**Description:** Submits a new payment for admin verification.

**Request Body:**
```javascript
{
  name: "John Doe",
  email: "john@example.com",
  phoneNumber: "1234567890",
  paymentId: "UPI123456789",
  screenshot: "data:image/png;base64,...",  // Base64 screenshot
  amount: 120
}
```

**Success Response (201):**
```javascript
{
  payment: {
    _id: "payment_id",
    name: "John Doe",
    email: "john@example.com",
    phoneNumber: "1234567890",
    paymentId: "UPI123456789",
    status: "pending",
    amount: 120,
    createdAt: "2026-04-12T..."
  }
}
```

---

### 6. Check Payment Status

**Endpoint:** `GET /payments/status`

**Description:** Checks payment status by email and payment ID.

**Query Parameters:**
- `email`: User's email
- `paymentId`: UPI transaction reference

**Success Response (200):**
```javascript
{
  payment: {
    _id: "payment_id",
    status: "approved",  // pending, approved, rejected, suspicious
    // ... other payment details
  }
}
```

---

## Admin Endpoints

### 7. Admin Login

**Endpoint:** `POST /admin/login`

**Description:** Authenticates an admin user.

**Request Body:**
```javascript
{
  email: "admin@example.com",
  password: "adminpassword"
}
```

**Success Response (200):**
```javascript
{
  token: "admin_jwt_token",
  admin: {
    id: "admin_id",
    email: "admin@example.com"
  }
}
```

---

### 8. Admin Dashboard Stats

**Endpoint:** `GET /admin/stats`

**Description:** Returns platform statistics.

**Authentication:** Required (Admin JWT token)

**Success Response (200):**
```javascript
{
  totalUsers: 150,
  totalPayments: 200,
  paymentsByStatus: {
    pending: 10,
    approved: 170,
    rejected: 15,
    suspicious: 5
  },
  totalReferrals: 120,
  totalApprovedAmount: 20400.00,
  // ===== NEW: Referral breakdown stats =====
  usersWithReferrals: 25,         // Users who have referred others
  usersWithoutReferrals: 125,     // Users who haven't referred anyone
  usersWhoWereReferred: 120,      // Users who joined via referral
  usersWhoJoinedAlone: 30         // Users who joined without referral
}
```

---

### 9. List Users

**Endpoint:** `GET /admin/users`

**Description:** Lists all users with optional search.

**Authentication:** Required (Admin JWT token)

**Query Parameters:**
- `q`: Search query (searches name and email)

**Success Response (200):**
```javascript
{
  users: [
    {
      _id: "user_id",
      name: "John Doe",
      email: "john@example.com",
      referralCode: "XYZ98765",
      referredBy: "ABC12345",
      referralsCount: 3,
      paymentApproved: true,
      createdAt: "2026-04-12T..."
    }
  ],
  total: 150
}
```

---

### 10. Delete User

**Endpoint:** `DELETE /admin/users/:id`

**Description:** Deletes a user and adjusts referrer's count.

**Authentication:** Required (Admin JWT token)

**URL Parameters:**
- `id`: User ID to delete

**Success Response (200):**
```javascript
{
  message: "User deleted"
}
```

---

### 11. List Payments

**Endpoint:** `GET /admin/payments`

**Description:** Lists all payments with filtering.

**Authentication:** Required (Admin JWT token)

**Query Parameters:**
- `q`: Search query (name, email, phone, payment ID)
- `status`: Filter by status (pending, approved, rejected, suspicious)

**Success Response (200):**
```javascript
{
  payments: [
    {
      _id: "payment_id",
      name: "John Doe",
      email: "john@example.com",
      phoneNumber: "1234567890",
      paymentId: "UPI123456789",
      status: "approved",
      amount: 120,
      createdAt: "2026-04-12T..."
    }
  ]
}
```

---

### 12. Verify Payment

**Endpoint:** `PATCH /admin/payments/:id/verify`

**Description:** Updates payment status (approve/reject).

**Authentication:** Required (Admin JWT token)

**URL Parameters:**
- `id`: Payment ID

**Request Body:**
```javascript
{
  action: "approved"  // approved, rejected, suspicious, pending
}
```

**Success Response (200):**
```javascript
{
  message: "Payment marked approved",
  payment: { /* updated payment object */ }
}
```

---

## ===== NEW: Referral Tracking Endpoints =====

### 13. Referral Tree

**Endpoint:** `GET /admin/referrals`

**Description:** Returns complete referral hierarchy showing who referred whom.

**Authentication:** Required (Admin JWT token)

**Success Response (200):**
```javascript
{
  tree: [
    {
      _id: "user_id",
      name: "Top Referrer",
      email: "top@example.com",
      referralCode: "TOP001",
      referredBy: null,
      referrerName: null,
      referrerEmail: null,
      referralsCount: 5,
      referredUsers: [
        {
          _id: "referred_user_id",
          name: "Referred User",
          email: "referred@example.com",
          referralCode: "REF001",
          createdAt: "2026-04-12T..."
        }
      ],
      createdAt: "2026-04-12T...",
      paymentApproved: true
    }
  ],
  total: 150
}
```

**Features:**
- Shows complete referral chain
- Includes referrer information for each user
- Lists all users referred by each user
- Sorted by referral count (most referrers first)

---

### 14. Get User's Referrals

**Endpoint:** `GET /admin/referrals/:id`

**Description:** Gets all users referred by a specific user.

**Authentication:** Required (Admin JWT token)

**URL Parameters:**
- `id`: User ID

**Success Response (200):**
```javascript
{
  user: {
    _id: "user_id",
    name: "Referrer",
    email: "referrer@example.com",
    referralCode: "REF001",
    referralsCount: 3
  },
  referredUsers: [
    {
      _id: "referred_id",
      name: "Referred User 1",
      email: "user1@example.com",
      referralCode: "USR001",
      createdAt: "2026-04-12T...",
      paymentApproved: true
    }
  ],
  total: 3
}
```

---

### 15. Filter Users by Referral Status

**Endpoint:** `GET /admin/users/filter`

**Description:** Filters users based on their referral status.

**Authentication:** Required (Admin JWT token)

**Query Parameters:**
- `filter`: Filter type
  - `has_referrals`: Users who have referred others
  - `no_referrals`: Users who haven't referred anyone
  - `referred`: Users who joined via referral code
  - `not_referred`: Users who joined without referral

**Success Response (200):**
```javascript
{
  users: [
    {
      _id: "user_id",
      name: "John Doe",
      email: "john@example.com",
      referralCode: "XYZ98765",
      referredBy: null,
      referralsCount: 5,
      paymentApproved: true,
      createdAt: "2026-04-12T..."
    }
  ],
  total: 25,
  filter: "has_referrals"
}
```

---

## Error Handling

All endpoints return errors in this format:

```javascript
{
  message: "Error description"
}
```

Common HTTP status codes:
- `200`: Success
- `201`: Created
- `400`: Bad Request (invalid input)
- `401`: Unauthorized (invalid credentials)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `409`: Conflict (duplicate resource)
- `500`: Internal Server Error

---

## Authentication

### User Authentication

Include user JWT token in requests via the API client's authentication mechanism.

### Admin Authentication

Include admin JWT token in requests via the admin API client.

Tokens expire after 7 days.

---

## Database Schema

### Users Collection

```javascript
{
  _id: String,              // Auto-generated unique ID
  name: String,             // User's full name
  email: String,            // Unique email (lowercase)
  password: String,         // SHA-256 hashed password
  referralCode: String,     // 8-character unique code (A-Z, 0-9)
  referredBy: String|null,  // Referral code of referrer (nullable)
  referralsCount: Number,   // Number of successful referrals
  paymentApproved: Boolean, // Whether payment is approved
  createdAt: String         // ISO timestamp
}
```

### Payments Collection

```javascript
{
  _id: String,              // Auto-generated unique ID
  name: String,             // User's name
  email: String,            // User's email
  phoneNumber: String,      // Contact number
  paymentId: String,        // UPI transaction reference
  screenshot: String,       // Base64 payment screenshot
  status: String,           // pending, approved, rejected, suspicious
  amount: Number,           // Payment amount
  createdAt: String         // ISO timestamp
}
```

### Admins Collection

```javascript
{
  _id: String,              // Auto-generated unique ID
  email: String,            // Admin email
  password: String,         // SHA-256 hashed password
  createdAt: String,        // ISO timestamp
  updatedAt: String         // ISO timestamp
}
```

---

## Validation Rules

1. **Email Uniqueness**: Each email can only be used once
2. **Referral Code Format**: 8 characters, uppercase letters and numbers only
3. **Referral Code Uniqueness**: Auto-generated codes are checked for collisions
4. **Payment Required**: Users must have approved payment to register
5. **Valid Referral Code**: If provided, must exist in the database
6. **Self-Referral Prevention**: Users cannot use their own referral code
7. **Password Security**: Passwords are hashed with SHA-256 + salt

---

## Notes

- All timestamps are in ISO 8601 format
- The application uses browser localStorage as the database
- Passwords are hashed using SHA-256 with salt (`pc-salt-2026`)
- JWT tokens are signed using HMAC-SHA256
- Default admin credentials: `jagan@gmail.com` / `jagan7523`
