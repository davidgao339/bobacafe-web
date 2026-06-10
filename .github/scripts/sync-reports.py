#!/usr/bin/env python3
"""
Download weekly reports from Databricks workspace
"""
import os
import json
import urllib.request
import urllib.error
import urllib.parse

workspace = os.environ["DATABRICKS_WORKSPACE"]
token = os.environ["DATABRICKS_TOKEN"]
src_path = "/Workspace/Users/davidgao734@gmail.com/boba-cafe/weekly-analysis/analysis-html"
dest_dir = "internal/reports"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# List files in the Databricks workspace directory
list_url = f"{workspace}/api/2.0/workspace/list?path={urllib.parse.quote(src_path)}"
req = urllib.request.Request(list_url, headers=headers)

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        objects = data.get("objects", [])
except urllib.error.HTTPError as e:
    print(f"Error listing Databricks files: {e}")
    print(e.read().decode())
    exit(1)

# Filter for HTML files
html_files = [obj for obj in objects if obj.get("path", "").endswith(".html") and obj.get("object_type") == "FILE"]

if not html_files:
    print("No HTML files found in Databricks")
    exit(1)

print(f"Found {len(html_files)} HTML reports")

# Ensure destination directory exists
os.makedirs(dest_dir, exist_ok=True)

# Download each HTML file
downloaded = []
for obj in html_files:
    file_path = obj["path"]
    file_name = os.path.basename(file_path)

    # Skip index.html from source; we'll regenerate it
    if file_name == "index.html":
        continue

    # Use workspace export API to download file content
    export_url = f"{workspace}/api/2.0/workspace/export?path={urllib.parse.quote(file_path)}&format=SOURCE"
    req = urllib.request.Request(export_url, headers=headers)

    try:
        with urllib.request.urlopen(req) as response:
            content = response.read()
            dest_path = os.path.join(dest_dir, file_name)
            with open(dest_path, "wb") as f:
                f.write(content)
            downloaded.append(file_name)
            print(f"  ✓ {file_name}")
    except urllib.error.HTTPError as e:
        print(f"  ✗ {file_name}: {e}")

if not downloaded:
    print("No reports downloaded")
    exit(1)

print(f"\nSuccessfully downloaded {len(downloaded)} reports")
