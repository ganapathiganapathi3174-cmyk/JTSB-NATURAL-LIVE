# Complete Workflow Test Guide

Follow this step-by-step guide to test the entire platform workflow.

## ✅ Prerequisites

- App running at: http://localhost:5173
- Browser console open (F12) to check for errors
- Clear localStorage first: In browser console, run `localStorage.clear()` then refresh

---

## 📋 Test Checklist

### 1️⃣ Payment Submission

**URL:** http://localhost:5173/payment

**What to check:**
- [ ] Page loads without errors
- [ ] QR code is displayed
- [ ] UPI ID is shown with copy button
- [ ] Payment form has all fields:
  - Full Name
  - Email
  - Phone Number (10 digits)
  - UPI Reference Number (10-20 digits)
  - File upload for screenshot
- [ ] Form validation works (try submitting empty fields)
- [ ] After submission, redirects to payment pending page

**Test Data:**
```
Full Name: Test User
Email: test@example.com
Phone: 9876543210
UPI Reference: 1234567890123
Screenshot: Upload any image < 2MB
```

**Expected Result:**
- Success message appears
- Redirects to `/payment/pending?utr=1234567890123`

---

### 2️⃣ Payment Status Check

**URL:** http://localhost:5173/payment/pending?utr=1234567890123

**What to check:**
- [ ] Page loads and shows payment status
- [ ] Status badge shows "pending" (yellow)
- [ ] Shows amount (₹120)
- [ ] Shows phone number
- [ ] Message says "Pending admin verification"

**Expected Result:**
- Payment status is visible
- Cannot register yet (payment not approved)

---

### 3️⃣ Admin Login

**URL:** http://localhost:5173/admin

**What to check:**
- [ ] Page loads without errors
- [ ] Login form shows email and password fields
- [ ] Login with default credentials works:
  - Email: `jagan@gmail.com`
  - Password: `jagan7523`
- [ ] After login, redirects to `/admin/dashboard`

**Expected Result:**
- Successful login
- Dashboard loads with stats

---

### 4️⃣ Admin Dashboard

**URL:** http://localhost:5173/admin/dashboard

**What to check:**
- [ ] Dashboard stats display:
  - Total users
  - Total payments
  - Total referrals
  - Total Approved Revenue (₹)
- [ ] Payments by status table shows counts
- [ ] Navigation links work:
  - Payments
  - Users
  - Refresh
  - Log out

**Expected Result:**
- Stats show correct data (1 payment pending)
- All navigation works

---

### 5️⃣ Admin - Approve Payment

**URL:** http://localhost:5173/admin/payments

**What to check:**
- [ ] Payments table shows the pending payment
- [ ] All fields visible:
  - Created date
  - Name
  - Email
  - Phone
  - UPI Reference
  - Status badge (pending)
  - Screenshot link
- [ ] Action buttons work:
  - Approve (blue)
  - Reject (red)
  - Suspicious (ghost)
- [ ] Click "Approve" button

**Expected Result:**
- Payment status changes to "approved" (green badge)
- User can now register with this email + UTR

---

### 6️⃣ User Registration

**URL:** http://localhost:5173/register

**What to check:**
- [ ] Page loads without errors
- [ ] Form shows all fields:
  - Full name
  - Email
  - Password (min 8 chars)
  - UPI Reference Number
  - Referral code (optional)
- [ ] Use same email and UTR as payment:
  - Email: `test@example.com`
  - UTR: `1234567890123`
- [ ] Registration succeeds
- [ ] Redirects to `/dashboard`

**Test Data:**
```
Full Name: Test User
Email: test@example.com
Password: TestPass123
UPI Reference: 1234567890123
Referral Code: (leave empty)
```

**Expected Result:**
- Registration successful
- Auto-logged in and redirected to dashboard

---

### 7️⃣ User Dashboard

**URL:** http://localhost:5173/dashboard

**What to check:**
- [ ] Dashboard loads without errors
- [ ] Shows user email in topbar
- [ ] Stats display:
  - Total members on platform
  - Your successful referrals
  - Payment status (Approved)
- [ ] Referral section shows:
  - Referral code (8 characters, uppercase)
  - Referral link
  - Copy link button works
- [ ] "Who referred you" section shows message
- [ ] Log out button works

**Expected Result:**
- All stats visible
- Referral code generated
- Can copy referral link

---

### 8️⃣ Referral System

**Test:** Register second user with referral code

**Steps:**
1. Log out from dashboard
2. Copy referral link from first user's dashboard
3. Open referral link (or go to `/register?ref=CODE`)
4. Submit another payment with different email:
   ```
   Email: test2@example.com
   UTR: 9876543210987
   ```
5. Admin: Approve the payment
6. Register with referral code auto-filled
7. Check first user's dashboard - referrals count should be 1

**What to check:**
- [ ] Referral code pre-fills from URL param
- [ ] Second user registration succeeds
- [ ] First user's referralsCount increments to 1
- [ ] Second user shows "Referred by [CODE]"

---

### 9️⃣ Admin - User Management

**URL:** http://localhost:5173/admin/users

**What to check:**
- [ ] Users table shows all registered users
- [ ] All fields visible:
  - Created date
  - Name
  - Email
  - Referral code
  - Referred by
  - Referrals count
  - Payment approved status
- [ ] Search works (search by name/email)
- [ ] Delete button works with confirmation
- [ ] After delete, referrer's count adjusts

---

### 🔟 Admin - Filter Payments

**URL:** http://localhost:5173/admin/payments

**What to check:**
- [ ] Search works (search by name/email/UTR)
- [ ] Status filter dropdown works:
  - All statuses
  - pending
  - approved
  - rejected
  - suspicious
- [ ] Filters combine correctly
- [ ] Refresh button works

---

## 🐛 Common Issues & Fixes

### Issue: Page is blank/white
**Fix:** 
- Open browser console (F12)
- Check for errors
- Clear localStorage: `localStorage.clear()`
- Refresh page

### Issue: Admin login fails
**Fix:**
- Check if database initialized: `localStorage.getItem('pc_db_admins')`
- If empty, clear localStorage and refresh
- Default admin created on first load

### Issue: Payment submission fails
**Fix:**
- Check file size < 2MB
- Check UTR format (10-20 digits)
- Check phone format (10 digits, starts with 6-9)
- Check console for errors

### Issue: Registration fails
**Fix:**
- Ensure payment is approved first
- Use same email + UTR as payment
- Password must be 8+ characters
- Check console for errors

### Issue: Data disappears on refresh
**Note:** This is expected if you clear browser data
- localStorage persists until cleared
- Each browser has separate storage

---

## ✅ Success Criteria

All tests pass if:
1. ✅ Can submit payment
2. ✅ Can check payment status
3. ✅ Admin can login
4. ✅ Admin can approve payments
5. ✅ User can register after approval
6. ✅ User can login and see dashboard
7. ✅ Referral system works
8. ✅ Admin can manage users/payments
9. ✅ No console errors during workflow
10. ✅ All navigation works

---

## 🎯 Quick Test Commands

**Clear all data:**
```javascript
localStorage.clear()
location.reload()
```

**Check admin exists:**
```javascript
JSON.parse(localStorage.getItem('pc_db_admins'))
```

**Check payments:**
```javascript
JSON.parse(localStorage.getItem('pc_db_payments'))
```

**Check users:**
```javascript
JSON.parse(localStorage.getItem('pc_db_users'))
```

---

## 📊 Expected Data After Full Test

After completing the entire workflow:
- **Admins:** 1 (default admin)
- **Payments:** 2 (both approved)
- **Users:** 2 (one referrer, one referred)
- **Referrals:** First user has referralsCount = 1

---

**Happy Testing! 🚀**
