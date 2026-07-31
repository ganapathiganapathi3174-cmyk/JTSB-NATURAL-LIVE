# Rollback Plan

## Rollback Trigger Conditions

Rollback immediately if any of the following occur after deployment:

| Condition | Severity | Action |
|-----------|----------|--------|
| `handler_unavailable` returns for any endpoint | CRITICAL | Rollback immediately |
| Payment creation (₹120/₹500/₹1000) fails | CRITICAL | Rollback immediately |
| `502 Bad Gateway` or `503 Service Unavailable` for >5 min | CRITICAL | Rollback immediately |
| `504 Gateway Timeout` for verification >15s | HIGH | Rollback if persistent |
| All admin endpoints return 401 (JWT broken) | CRITICAL | Rollback immediately |
| Database migration fails | CRITICAL | Rollback immediately |
| `npm run build` fails (0 errors expected) | N/A (pre-deploy) | Do not deploy |
| Any test suite failure | HIGH | Fix before deploying |

## Rollback Steps

### Step 1: Identify the Bad Deploy
1. Open Vercel Dashboard → Your Project → Deployments
2. Find the most recent deployment
3. Note the deployment URL and timestamp

### Step 2: Rollback to Previous Deployment
1. In Vercel Dashboard → Deployments tab
2. Find the **previous** successful deployment (the one before the current bad deploy)
3. Click the three dots (`...`) on that deployment
4. Select **"Promote to Production"**
5. Vercel will instantly switch production traffic to the previous deployment
6. Confirm the rollback URL is now live

### Step 3: Verify Rollback Success
1. Wait 60 seconds for the rollback deployment to be active
2. Test the payment selection page:
   ```
   curl https://<your-project>.vercel.app/api/getHealthStatus
   ```
   Should return `200 OK` with health metrics
3. Test payment creation (₹120):
   ```
   curl -X POST https://<your-project>.vercel.app/api/createPaymentOrder \
     -H "Content-Type: application/json" \
     -d '{"type":"registration","amount":120,"pendingRegId":"test","userId":"test123"}'
   ```
   Should return `200 OK` with an order object (NOT `{error:'handler_unavailable'}`)

### Step 4: Investigate the Failed Deploy
1. Go to Vercel Dashboard → Deployments → Failed deploy
2. Check **Function Logs** for each route
3. Look for:
   - `MODULE_NOT_FOUND` errors → missing dependency in package.json or not included in vercel.json `includeFiles`
   - `handler_unavailable` → a `require()` failed (tesseract.js, native module, or missing file)
   - `500 Internal Server Error` → runtime exception in handler code
4. Cross-reference with the error in your `api/index.js` log at line 118 (catch block in `getHandler()`)

### Step 5: Fix and Re-deploy
1. Fix the root cause in the codebase
2. Run `npm run build` and `npm test` locally (both must pass)
3. Commit the fix
4. Re-deploy with `vercel --prod`

## Rollback Rollback (If Rollback Also Fails)

If the previous deployment ALSO has issues:

1. **Revert the code changes** that caused the issue:
   - The most recent commit is `88914e6` (architecture: lazy-load verification engine)
   - The previous commit is `e3d1d8a` (Add migration-phase6.sql validation report)
   - The commit before that is `87fff10` (Production hardening)
2. Use `git revert <commit-hash>` to create a revert commit
3. Push the revert commit to `main` (triggers auto-deploy, or deploy manually)

## Critical Files Modified in This Deploy

| File | Change | Risk if Broken |
|------|--------|----------------|
| `api/_newEngine/index.js` | Static imports → lazy getters | If lazy loading breaks, OCR/AI won't load at verification time |
| `api/_paymentOrderManager.js` | verification7.js moved from top-level to lazy | If lazy require fails during verification, get `handler_unavailable` only when verifying (not when creating payment) |
| `migration-phase6.sql` | DB schema migration | If migration fails, DB schema mismatch → all DB operations fail |

## Quick Reference: Rollback Command Sequence

```bash
# 1. Revert to previous good commit
git revert HEAD --no-edit
git push origin main

# 2. Or manually promote previous deploy in Vercel dashboard
# (Vercel Dashboard → Deployments → Previous good deploy → ⋮ → Promote to Production)

# 3. Verify rollback success
curl https://<project>.vercel.app/api/getHealthStatus
# Expected: { status: "ok" }

# 4. Test payment creation
curl -X POST https://<project>.vercel.app/api/createPaymentOrder \
  -H "Content-Type: application/json" \
  -d '{"type":"registration","amount":120,"userId":"test","pendingRegId":"test"}'
# Expected: { orderId: "...", status: "pending", ... }
# NOT: { error: "handler_unavailable" }
```