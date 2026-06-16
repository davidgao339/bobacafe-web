# Tapioca Cooking Plan

Dynamic tapioca cooking plan with Databricks integration and live refresh.

## Features

- **Real-time data**: Fetches sales data from Databricks SQL warehouse
- **Rolling window**: Configurable (default 90 days) to emphasize recent trends
- **Percentile selection**: Choose between Avg, p75, p90, p95, or Max
- **Grams calculator**: Automatic grams per portion calculation
- **Bilingual**: English and Russian UI
- **Refresh button**: Fetch fresh data on demand

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DATABRICKS_TOKEN="your-token"
export DATABRICKS_HOST="your-host"
export DATABRICKS_HTTP_PATH="your-path"

# Run Flask app
python app.py
```

Visit `http://localhost:5000`

## Deployment

### Option 1: Heroku

```bash
heroku create your-app-name
heroku config:set DATABRICKS_TOKEN="..."
heroku config:set DATABRICKS_HOST="..."
heroku config:set DATABRICKS_HTTP_PATH="..."
git push heroku main
```

### Option 2: Google Cloud Run

```bash
gcloud run deploy tapioca-plan \
  --source . \
  --platform managed \
  --region us-central1 \
  --set-env-vars DATABRICKS_TOKEN="...",DATABRICKS_HOST="...",DATABRICKS_HTTP_PATH="..."
```

### Option 3: Railway.app

1. Connect repo to Railway
2. Add environment variables
3. Deploy

## Environment Variables

- `DATABRICKS_TOKEN`: PAT token for Databricks
- `DATABRICKS_HOST`: Databricks workspace host
- `DATABRICKS_HTTP_PATH`: SQL warehouse HTTP path

Defaults (from `boba-cafe-databricks/POS/pipeline/secrets.py`) are used if not set.

## Configuration

Edit `app.py` to change:
- `ROLLING_DAYS_DEFAULT`: Historical window (line ~30)
- `SLOT_ORDER`: Cooking time slots
- `PERCENTILES`: Available percentile options
