# Appwrite Database Schema Specification

## Database
- **Name:** payments
- **ID:** `6a302b6e0033adabbbe6`
- **Type:** tablesdb (requires predefined attributes)

---

## Collection 1: `payment_sessions` (15 attributes)

| # | Attribute Name     | Type    | Size | Required | Default | Notes |
|---|--------------------|---------|------|----------|---------|-------|
| 1 | `sessionId`        | string  | 64   | No       | —       | Used as document $id |
| 2 | `email`            | string  | 255  | No       | —       | For registration payments |
| 3 | `name`             | string  | 255  | No       | —       | For registration payments |
| 4 | `phone`            | string  | 20   | No       | —       | Indian mobile numbers |
| 5 | `amount`           | string  | 32   | No       | —       | e.g. "120" |
| 6 | `type`             | string  | 64   | No       | —       | "registration" or "topup" |
| 7 | `paymentStatus`    | string  | 64   | No       | —       | "created" → "completed" → "verified" |
| 8 | `createdAt`        | string  | 64   | No       | —       | ISO 8601 string |
| 9 | `expiresAt`        | string  | 64   | No       | —       | ISO 8601 string |
| 10| `userId`           | string  | 128  | No       | —       | For logged-in user payments |
| 11| `razorpayPaymentId`| string  | 255  | No       | —       | Set on payment completion |
| 12| `razorpayOrderId`  | string  | 255  | No       | —       | Set on payment completion |
| 13| `verificationCode` | string  | 64   | No       | —       | Links to verification_codes doc |
| 14| `completedAt`      | string  | 64   | No       | —       | ISO 8601 string |
| 15| `verifiedAt`       | string  | 64   | No       | —       | ISO 8601 string |

---

## Collection 2: `verification_codes` (13 attributes)

| # | Attribute Name  | Type    | Size | Required | Default | Notes |
|---|-----------------|---------|------|----------|---------|-------|
| 1 | `code`          | string  | 64   | No       | —       | Format "JTSB-XXXXXX", used as $id |
| 2 | `sessionId`     | string  | 64   | No       | —       | Links to payment_sessions |
| 3 | `userId`        | string  | 128  | No       | —       | User who generated the code |
| 4 | `type`          | string  | 64   | No       | —       | "registration" or "topup" |
| 5 | `amount`        | string  | 32   | No       | —       | Stored as string |
| 6 | `paymentId`     | string  | 255  | No       | —       | Razorpay payment ID |
| 7 | `orderId`       | string  | 255  | No       | —       | Razorpay order ID |
| 8 | `paymentStatus` | string  | 64   | No       | —       | "active" → "used" |
| 9 | `approved`      | boolean | —    | No       | false   | Becomes true on verification |
| 10| `createdAt`     | string  | 64   | No       | —       | ISO 8601 string |
| 11| `expiresAt`     | string  | 64   | No       | —       | ISO 8601 string |
| 12| `used`          | boolean | —    | No       | false   | Becomes true on verification |
| 13| `usedAt`        | string  | 64   | No       | —       | ISO 8601 string |

---

## Collection 3: `users` (36 attributes)

Maps to Firebase `users_new`. Document $id = userId.

| # | Attribute Name           | Type    | Size | Required | Default | Notes |
|---|--------------------------|---------|------|----------|---------|-------|
| 1 | `userId`                 | string  | 128  | No       | —       | Same as document $id |
| 2 | `name`                   | string  | 255  | No       | —       | User's full name |
| 3 | `email`                  | string  | 255  | No       | —       | Used for login |
| 4 | `phone`                  | string  | 20   | No       | —       | Indian mobile |
| 5 | `password`               | string  | 128  | No       | —       | SHA-256 hash |
| 6 | `status`                 | string  | 32   | No       | "pending" | "pending", "active", "rejected" |
| 7 | `account_status`         | string  | 32   | No       | "pending" | "pending", "active", "rejected" |
| 8 | `payment_status`         | string  | 32   | No       | "unpaid"  | "unpaid","pending","approved","rejected"|
| 9 | `referral_code`          | string  | 32   | No       | —       | Unique 8-char code |
| 10| `referred_by`            | string  | 32   | No       | —       | Referral code of referrer |
| 11| `referrals_count`        | integer | —    | No       | 0        | Number of referrals made |
| 12| `joinedDate`             | string  | 64   | No       | —       | ISO 8601 |
| 13| `approvedDate`           | string  | 64   | No       | —       | ISO 8601 |
| 14| `lastActiveAt`           | string  | 64   | No       | —       | ISO 8601 |
| 15| `created_at`             | string  | 64   | No       | —       | ISO 8601 |
| 16| `is_first_payment_done`  | boolean | —    | No       | false   | First registration payment |
| 17| `profile_picture_url`    | string  | 512  | No       | —       | Base64 or URL |
| 18| `theme_color`            | string  | 16   | No       | —       | e.g. "#ff6b35" |
| 19| `upi_screenshot_url`     | string  | 512  | No       | —       | Payment proof |
| 20| `utr_number`             | string  | 64   | No       | —       | UTR for payment |
| 21| `cycle_payment_status`   | string  | 32   | No       | —       | "pending","approved","reset" |
| 22| `cycle_upi_screenshot_url`| string | 512  | No       | —       | Cycle payment proof |
| 23| `cycle_payment_utr`      | string  | 64   | No       | —       | Cycle payment UTR |
| 24| `admin_approval_status`  | string  | 32   | No       | "pending" | "pending","approved","rejected" |
| 25| `approved_by`            | string  | 128  | No       | —       | Admin name/id |
| 26| `approved_at`            | string  | 64   | No       | —       | ISO 8601 |
| 27| `rejected_by`            | string  | 128  | No       | —       | Admin name/id |
| 28| `rejected_at`            | string  | 64   | No       | —       | ISO 8601 |
| 29| `rejection_reason`       | string  | 512  | No       | —       | Reason for rejection |
| 30| `manual_override`        | boolean | —    | No       | false   | Admin manually overrode |
| 31| `validation_status`      | string  | 32   | No       | —       | OCR validation status |
| 32| `confidence_score`       | integer | —    | No       | 0        | OCR confidence 0-100 |
| 33| `screenshot_hash`        | string  | 128  | No       | —       | SHA-256 of screenshot |
| 34| `referral_view_count`    | integer | —    | No       | 0        | Referral link clicks |
| 35| `sponsor_awaiting_credit`| boolean | —    | No       | false   | Awaiting sponsor credit |
| 36| `inactive_reason`        | string  | 256  | No       | —       | Why user was deactivated |

---

## Collection 4: `referrals` (5 attributes)

Maps to Firebase `referrals_new`.

| # | Attribute Name | Type   | Size | Required | Default | Notes |
|---|----------------|--------|------|----------|---------|-------|
| 1 | `user_id`      | string | 128  | No       | —       | User who owns referrals |
| 2 | `name`         | string | 255  | No       | —       | Referred person's name |
| 3 | `email`        | string | 255  | No       | —       | Referred person's email |
| 4 | `phone`        | string | 20   | No       | —       | Referred person's phone |
| 5 | `created_at`   | string | 64   | No       | —       | ISO 8601 |

---

## Collection 5: `topups` (16 attributes)

Maps to Firebase `topups_new`.

| # | Attribute Name       | Type    | Size | Required | Default | Notes |
|---|----------------------|---------|------|----------|---------|-------|
| 1 | `userId`             | string  | 128  | No       | —       | User who made topup |
| 2 | `userName`           | string  | 255  | No       | —       | User's name at time of topup |
| 3 | `userEmail`          | string  | 255  | No       | —       | User's email |
| 4 | `userPhone`          | string  | 20   | No       | —       | User's phone |
| 5 | `userReferralCode`   | string  | 32   | No       | —       | User's referral code |
| 6 | `referred_by`        | string  | 32   | No       | —       | Referral code of referrer |
| 7 | `amount`             | string  | 32   | No       | —       | Topup amount |
| 8 | `transactionId`      | string  | 128  | No       | —       | UTR / transaction ID |
| 9 | `screenshotData`     | string  | 9999 | No       | —       | Base64 screenshot |
| 10| `sessionId`          | string  | 64   | No       | —       | Payment session ID |
| 11| `verifiedViaCode`    | boolean | —    | No       | false   | Verified via code |
| 12| `status`             | string  | 32   | No       | "pending" | "pending","approved","rejected" |
| 13| `adminId`            | string  | 128  | No       | —       | Admin who processed |
| 14| `approvedAt`         | string  | 64   | No       | —       | ISO 8601 |
| 15| `rejectedAt`         | string  | 64   | No       | —       | ISO 8601 |
| 16| `createdAt`          | string  | 64   | No       | —       | ISO 8601 |

---

## Collection 6: `topup_income` (10 attributes)

Maps to Firebase `topup_referral_income`.

| # | Attribute Name | Type   | Size | Required | Default | Notes |
|---|----------------|--------|------|----------|---------|-------|
| 1 | `userId`       | string | 128  | No       | —       | Income recipient |
| 2 | `fromUserId`   | string | 128  | No       | —       | Who made the topup |
| 3 | `fromUserName` | string | 255  | No       | —       | Name of the person |
| 4 | `topupId`      | string | 128  | No       | —       | Reference to topup doc |
| 5 | `amount`       | string | 32   | No       | —       | Income amount |
| 6 | `status`       | string | 32   | No       | "pending" | "pending", "claimed" |
| 7 | `claimedAt`    | string | 64   | No       | —       | ISO 8601 |
| 8 | `createdAt`    | string | 64   | No       | —       | ISO 8601 |

---

## Collection 7: `notifications` (10 attributes)

Maps to Firebase `notifications`.

| # | Attribute Name | Type   | Size | Required | Default | Notes |
|---|----------------|--------|------|----------|---------|-------|
| 1 | `senderId`     | string | 128  | No       | —       | Admin ID |
| 2 | `receiverId`   | string | 128  | No       | —       | User ID |
| 3 | `receiverName` | string | 255  | No       | —       | User's name |
| 4 | `senderName`   | string | 255  | No       | —       | Admin's name |
| 5 | `title`        | string | 255  | No       | —       | Notification title |
| 6 | `message`      | string | 2048 | No       | —       | Notification body |
| 7 | `type`         | string | 64   | No       | "info"   | "info","approval","payment" |
| 8 | `status`       | string | 32   | No       | "unread" | "unread","read" |
| 9 | `createdAt`    | string | 64   | No       | —       | ISO 8601 |
| 10| `readAt`       | string | 64   | No       | —       | ISO 8601 |

---

## Collection 8: `chat_messages` (7 attributes)

| # | Attribute Name | Type    | Size | Required | Default | Notes |
|---|----------------|---------|------|----------|---------|-------|
| 1 | `convoId`      | string  | 128  | No       | —       | Conversation ID |
| 2 | `senderId`     | string  | 128  | No       | —       | "admin" or userId |
| 3 | `receiverId`   | string  | 128  | No       | —       | Other participant |
| 4 | `messageText`  | string  | 2048 | No       | —       | Message content |
| 5 | `createdAt`    | string  | 64   | No       | —       | ISO 8601 |
| 6 | `isRead`       | boolean | —    | No       | false   | Read status |
| 7 | `isDelivered`  | boolean | —    | No       | false   | Delivery status |

---

## Collection 9: `chat_conversations` (7 attributes)

| # | Attribute Name | Type   | Size | Required | Default | Notes |
|---|----------------|--------|------|----------|---------|-------|
| 1 | `convoId`      | string | 128  | No       | —       | Same as document $id |
| 2 | `userId`       | string | 128  | No       | —       | User participant |
| 3 | `userName`     | string | 255  | No       | —       | User's display name |
| 4 | `userEmail`    | string | 255  | No       | —       | User's email |
| 5 | `createdAt`    | string | 64   | No       | —       | ISO 8601 |
| 6 | `updatedAt`    | string | 64   | No       | —       | ISO 8601 |
| 7 | `lastMessage`  | string | 255  | No       | —       | Preview of last message |

---

## Collection 10: `admins` (4 attributes)

| # | Attribute Name | Type   | Size | Required | Default | Notes |
|---|----------------|--------|------|----------|---------|-------|
| 1 | `email`        | string | 255  | No       | —       | Admin login email |
| 2 | `password`     | string | 128  | No       | —       | SHA-256 hash |
| 3 | `createdAt`    | string | 64   | No       | —       | ISO 8601 |

---

## Collection 11: `payment_images` (6 attributes)

| # | Attribute Name | Type   | Size  | Required | Default | Notes |
|---|----------------|--------|-------|----------|---------|-------|
| 1 | `fileId`       | string | 128   | No       | —       | File identifier |
| 2 | `userId`       | string | 128   | No       | —       | Owner |
| 3 | `type`         | string | 32    | No       | —       | "payment" or "cycle" |
| 4 | `base64`       | string | 9999  | No       | —       | Base64 image data |
| 5 | `fileName`     | string | 255   | No       | —       | Original filename |
| 6 | `createdAt`    | string | 64    | No       | —       | ISO 8601 |

---

## Architecture

```
Frontend (browser)
  ├── Appwrite Client SDK (anonymous session)
  │   ├── Users: create, read, update own data
  │   ├── Auth: register, login, logout
  │   ├── Referrals: read own referrals
  │   ├── Topups: create, read own topups
  │   ├── Notifications: read own, mark read
  │   ├── Chat: send, receive messages
  │   └── Realtime subscriptions (onSnapshot equivalent)
  │
  └── Cloudflare Worker (server-side proxy, holds API key)
      ├── POST /api/appwrite/create-session
      ├── POST /api/appwrite/generate-code
      ├── POST /api/appwrite/verify-code
      ├── GET  /api/appwrite/code?sessionId=
      ├── POST /api/appwrite/register      (future)
      ├── POST /api/appwrite/topup          (future)
      ├── POST /api/appwrite/approve        (future)
      └── GET  /api/health
```

**Security**: API key stored in Worker secret only. Never in frontend bundle.

---

## Worker Setup

1. Create `my-worker/.dev.vars` for local dev:
   ```
   APPWRITE_API_KEY=your_key_here
   ```

2. Production secret:
   ```
   npx wrangler secret put APPWRITE_API_KEY
   ```

3. Update `VITE_WORKER_URL` in `frontend/.env.local`.

---

## Console Setup

1. Go to https://cloud.appwrite.io → project `6a302b460028b21fdfa0`
2. Open **Databases** → `payments`
3. Create each collection with the exact ID listed above
4. For each collection, add all attributes per the table (Key = attribute name, Type/Size as specified)
5. All attributes: Required = No, Default = blank unless specified

After creating all collections/attributes:

6. **API Key** for Worker (Settings → API Keys → Create Key):
   - Name: "Worker Full Access"
   - Scopes: `documents.read`, `documents.write`, `collections.read`
   - Set as Worker secret

7. **Optional — API Key for schema script** (if using `setup-appwrite-schema.mjs`):
   - Name: "Schema Setup"
   - Scopes: `collections.read`, `collections.write`, `attributes.read`, `attributes.write`, `documents.read`, `documents.write`
   - Use with: `node scripts/setup-appwrite-schema.mjs`

---

## Type Rules

- Dates: ISO 8601 strings (`"2026-06-16T12:00:00.000Z"`), NOT Appwrite `datetime` type.
- Amounts: stored as **strings** (e.g. `"120"`), converted with `String()` / `Number()`.
- Booleans: stored as actual booleans, code handles string `'true'` defensively.
- Large data (screenshots): stored as base64 strings in `screenshotData` or `payment_images` collection (max 9,999 chars).
