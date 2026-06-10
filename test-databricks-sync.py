#!/usr/bin/env python3
"""
Test script to verify Databricks connection and report download
Run this before pushing the GitHub Actions workflow
"""
import os
import json
import sys
import urllib.request
import urllib.error

# Fix encoding on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Configuration
WORKSPACE = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
TOKEN = os.environ.get("DATABRICKS_TOKEN")
SRC_PATH = "/Workspace/Users/davidgao734@gmail.com/boba-cafe/weekly-analysis/analysis-html"

if not TOKEN:
    print("❌ DATABRICKS_TOKEN environment variable not set")
    print("   Set it: export DATABRICKS_TOKEN=dapi...")
    exit(1)

print(f"🔍 Testing Databricks connection...")
print(f"   Workspace: {WORKSPACE}")
print(f"   Token: {TOKEN[:10]}...{TOKEN[-4:]}")
print(f"   Source path: {SRC_PATH}")
print()

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

# Test 1: List files
print("📋 Step 1: Listing files in Databricks workspace...")
import urllib.parse
list_url = f"{WORKSPACE}/api/2.0/workspace/list?path={urllib.parse.quote(SRC_PATH)}"
req = urllib.request.Request(list_url, headers=headers)

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        objects = data.get("objects", [])
        html_files = [obj for obj in objects if obj.get("path", "").endswith(".html") and obj.get("object_type") == "FILE"]

        if html_files:
            print(f"   ✓ Found {len(html_files)} HTML files:")
            for obj in sorted(html_files, key=lambda x: x["path"], reverse=True)[:5]:
                print(f"     - {os.path.basename(obj['path'])}")
        else:
            print(f"   ✗ No HTML files found")
            exit(1)

except urllib.error.HTTPError as e:
    print(f"   ✗ HTTP Error {e.code}: {e.read().decode()}")
    print()
    print("💡 Troubleshooting:")
    print("   - Check token is valid (not expired)")
    print("   - Check workspace URL is correct")
    print("   - Check source path exists in Databricks")
    exit(1)
except Exception as e:
    print(f"   ✗ Error: {e}")
    exit(1)

# Test 2: Try downloading one file
print()
print("📥 Step 2: Testing file download...")
if html_files:
    test_file = html_files[0]
    filename = os.path.basename(test_file["path"])

    export_url = f"{WORKSPACE}/api/2.0/workspace/export?path={test_file['path']}&format=SOURCE"
    req = urllib.request.Request(export_url, headers=headers)

    try:
        with urllib.request.urlopen(req) as response:
            content = response.read()
            print(f"   ✓ Successfully downloaded {filename} ({len(content)} bytes)")
    except Exception as e:
        print(f"   ✗ Download failed: {e}")
        exit(1)

print()
print("✅ All tests passed! Ready to setup GitHub Actions workflow.")
print()
print("Next steps:")
print("  1. Go to GitHub repo Settings → Secrets and variables → Actions")
print("  2. Add DATABRICKS_TOKEN secret with your PAT token")
print("  3. Push the workflow file (.github/workflows/sync-databricks-reports.yml)")
print("  4. Run the workflow manually to test, or wait for Monday 09:00 UTC")
