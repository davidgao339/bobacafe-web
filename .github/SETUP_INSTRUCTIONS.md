# Setup: Automated Weekly Reports

This workflow automatically syncs Databricks analysis reports to `internal/reports/` every Monday at 09:00 UTC.

## Step 1: Create Databricks PAT Token (with all-apis scope)

1. In Databricks workspace, go to **Settings → User Settings → Access Tokens**
2. Click **Generate New Token**
3. Name: `GitHub Actions Sync`
4. Lifetime: 90 days (or your preference)
5. **Copy the token** (you'll only see it once)

## Step 2: Add GitHub Secret

1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `DATABRICKS_TOKEN`
4. Value: Paste the token you just created
5. Click **Add secret**

⚠️ **Security:** Never commit the token to git. Use GitHub Secrets only.

**Note:** The token needs the `all-apis` scope to access workspace files. Databricks tokens created in User Settings automatically get this scope.

## Step 2: Verify Workflow is Enabled

1. Go to **Actions** tab in GitHub
2. Look for "Sync Weekly Reports from Databricks"
3. It should be enabled (green checkmark)

## Step 3: Optional — Test the Workflow

Click the workflow → **Run workflow** → **Run workflow** to test immediately.

Once pushed to `main`, the workflow will:
- **Run:** Every Monday at 09:00 UTC
- **Actions:**
  1. Download latest `.html` files from Databricks workspace
  2. Generate `internal/reports/index.html` with sorted report links
  3. Commit and push changes (auto-triggers GitHub Pages deploy)

## Step 4: Optional — Schedule Databricks Notebook

The workflow assumes your analysis notebook runs separately. If you want to automate that too:

1. In Databricks, go to **Workflows → Jobs**
2. Click **Create job**
3. **Task:** Select notebook `/Users/davidgao734@gmail.com/boba-cafe/weekly-analysis/weekly_report`
4. **Schedule:** Weekly, Monday 8:00 AM (UTC) 
5. **Click Create**

This ensures the analysis completes before the GitHub Actions sync runs at 09:00 UTC.

---

**Result:** Every Monday morning, new reports appear on `bobacafe.net/internal/reports/` with zero manual work.
