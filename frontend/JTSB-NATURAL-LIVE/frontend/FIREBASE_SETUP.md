# Firebase Setup Guide

This app uses **Firebase Firestore** as its shared database so all users see the same data after hosting.

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"**
3. Name it (e.g. `jtsb-natural-live`)
4. Disable Google Analytics (not needed)
5. Click **Create project**

## Step 2: Enable Firestore Database

1. In your Firebase project, go to **Build** → **Firestore Database**
2. Click **Create database**
3. Select **Start in test mode** (for development)
4. Choose a location (closest to your users)
5. Click **Enable**

## Step 3: Get Your Config

1. Go to **Project Settings** (gear icon ⚙️)
2. Scroll to **Your apps** section
3. Click the **Web** icon `</>` (</>)
4. Register the app (any name)
5. Copy the `firebaseConfig` object values

## Step 4: Add Config to Your App

### For Local Development:
Create `frontend/.env.local` (gitignored) with:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

### For Vercel Deployment:
Go to Vercel → Your Project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | Your API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | your-project.firebaseapp.com |
| `VITE_FIREBASE_PROJECT_ID` | your-project-id |
| `VITE_FIREBASE_STORAGE_BUCKET` | your-project.appspot.com |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Your sender ID |
| `VITE_FIREBASE_APP_ID` | Your app ID |

### For Netlify Deployment:
Go to Netlify → Site settings → Build & deploy → Environment:

Add the same 6 variables as above.

## Step 5: Set Firestore Security Rules

In Firebase Console → Firestore Database → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read/write to all collections (public access)
    // This is fine for this app since auth is handled at app level
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

⚠️ For production, tighten these rules to only allow authenticated access.

## Step 6: Deploy!

```bash
cd frontend
npm run build
```

Then deploy the `dist/` folder to Vercel, Netlify, or any static host.

## Troubleshooting

### "Permission denied" error
- Check Firestore rules are set to allow reads/writes
- Verify your Firebase config values are correct

### "No approved payment found" error
- Make sure the admin approved the payment BEFORE the user registers
- Check Firestore → `payments` collection to verify payment exists

### Admin can't see users
- Verify all users are using the same Firebase project (same config)
- Check Firestore → `users` collection has documents

### Default admin not created
- On first load, the app seeds the admin into Firestore
- Check Firestore → `admins` collection for `jagan@gmail.com`
- If missing, clear the collection and reload the app
