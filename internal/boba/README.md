# Tapioca Cooking Plan

Dynamic tapioca cooking plan with Databricks integration and adjustable parameters.

Built with **Streamlit** for instant interactive updates.

## Features

✨ **User-adjustable rolling window** — Slider from 7 to 180 days  
📊 **Real-time Databricks data** — Live SQL warehouse queries  
🎚️ **Percentile selection** — Avg, p75, p90, p95, Max with tooltips  
📐 **Dynamic grams calculator** — Portion sizing updates instantly  
🔄 **Refresh button** — Force data reload on demand  
🎨 **Color-coded severity** — Visual risk assessment (🟢 green, 🟡 yellow, 🔴 red)  

## Local Development

```bash
# Install dependencies
pip install -r requirements-streamlit.txt

# Create .streamlit/secrets.toml
mkdir -p .streamlit
cp .streamlit/secrets.toml.example .streamlit/secrets.toml
# Edit secrets.toml with your Databricks credentials

# Run Streamlit app
streamlit run streamlit_app.py
```

Visit `http://localhost:8501`

## Deployment

### **Streamlit Cloud** (recommended - free tier)

1. Push to GitHub
2. Go to [share.streamlit.io](https://share.streamlit.io)
3. Deploy from repo
4. Add secrets in Streamlit Cloud UI

### **Google Cloud Run**

```bash
gcloud run deploy tapioca-plan \
  --source internal/boba \
  --entry-point streamlit_app.py \
  --set-env-vars DATABRICKS_TOKEN="...",DATABRICKS_HOST="...",DATABRICKS_HTTP_PATH="..."
```

### **Heroku**

```bash
heroku create tapioca-plan
heroku config:set DATABRICKS_TOKEN="..." DATABRICKS_HOST="..." DATABRICKS_HTTP_PATH="..."
heroku config:add BUILDPACK_URL=https://github.com/heroku/heroku-buildpack-python.git
git push heroku main
```

## Environment Variables

Required:
- `DATABRICKS_TOKEN`: PAT token for Databricks SQL
- `DATABRICKS_HOST`: Databricks workspace host  
- `DATABRICKS_HTTP_PATH`: SQL warehouse HTTP path

## Configuration

Edit `streamlit_app.py`:
- Line 20: `SLOT_ORDER` — Cooking time slots
- Line 21: `PERCENTILES` — Available percentile options
- Sidebar default values in UI code

The rolling days window is **user-selectable** (7-180 range) with no code changes needed.
