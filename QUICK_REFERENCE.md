# Cloud Run Quick Reference Card

## 🚀 Deploy Commands

### Deploy All Services
```bash
./scripts/deploy.sh
```

### Deploy Individual Services
```bash
./scripts/deploy.sh backend
./scripts/deploy.sh mtg-backend
./scripts/deploy.sh frontend
./scripts/deploy.sh mtg-frontend
```

### Manual Deployment
```bash
# Backend API
gcloud builds submit --tag gcr.io/$PROJECT_ID/maxtory-backend --dockerfile=backend/Dockerfile .
gcloud run deploy maxtory-backend --image gcr.io/$PROJECT_ID/maxtory-backend --region us-central1

# MTG Backend
gcloud builds submit --tag gcr.io/$PROJECT_ID/maxtory-mtg-backend --dockerfile=mtg/Dockerfile .
gcloud run deploy maxtory-mtg-backend --image gcr.io/$PROJECT_ID/maxtory-mtg-backend --region us-central1

# Frontend
gcloud builds submit --tag gcr.io/$PROJECT_ID/maxtory-frontend --dockerfile=frontend/Dockerfile --build-arg VITE_API_URL=https://api.maxtory.app .
gcloud run deploy maxtory-frontend --image gcr.io/$PROJECT_ID/maxtory-frontend --region us-central1

# MTG Frontend
gcloud builds submit --tag gcr.io/$PROJECT_ID/maxtory-mtg-frontend --dockerfile=mtg/frontend/Dockerfile --build-arg VITE_MTG_API_URL=https://mtg-api.maxtory.app .
gcloud run deploy maxtory-mtg-frontend --image gcr.io/$PROJECT_ID/maxtory-mtg-frontend --region us-central1
```

## 🔍 Monitoring Commands

### View Service URLs
```bash
gcloud run services list --region us-central1
```

### Get Specific Service URL
```bash
gcloud run services describe maxtory-backend --region us-central1 --format 'value(status.url)'
```

### View Logs (Last 50 Lines)
```bash
gcloud run services logs read maxtory-backend --region us-central1 --limit 50
```

### Follow Logs in Real-Time
```bash
gcloud run services logs tail maxtory-backend --region us-central1
```

### View Errors Only
```bash
gcloud run services logs read maxtory-backend --region us-central1 --log-filter='severity>=ERROR' --limit 20
```

### View Metrics
```bash
gcloud run services describe maxtory-backend --region us-central1
```

## 🐳 Local Development

### Start All Services
```bash
docker-compose up
```

### Start Specific Service
```bash
docker-compose up backend
docker-compose up mtg-backend
docker-compose up frontend
docker-compose up mtg-frontend
```

### Rebuild and Start
```bash
docker-compose up --build
```

### Stop All Services
```bash
docker-compose down
```

### View Logs
```bash
docker-compose logs -f backend
```

### Clean Rebuild
```bash
docker-compose down -v
docker-compose build --no-cache
docker-compose up
```

## 🔧 Configuration Commands

### Update Service Configuration
```bash
# Update memory
gcloud run services update maxtory-backend --memory 1Gi --region us-central1

# Update CPU
gcloud run services update maxtory-backend --cpu 2 --region us-central1

# Update min instances
gcloud run services update maxtory-backend --min-instances 1 --region us-central1

# Update max instances
gcloud run services update maxtory-backend --max-instances 20 --region us-central1

# Update concurrency
gcloud run services update maxtory-backend --concurrency 100 --region us-central1

# Update environment variables
gcloud run services update maxtory-backend --set-env-vars NODE_ENV=production,DEBUG=true --region us-central1

# Update secrets
gcloud run services update maxtory-backend --set-secrets OPEN_ROUTER_KEY=openrouter-key:latest --region us-central1
```

### Enable Features
```bash
# Enable CPU always allocated (faster response)
gcloud run services update maxtory-backend --no-cpu-throttling --region us-central1

# Enable CPU boost (faster cold starts)
gcloud run services update maxtory-backend --cpu-boost --region us-central1

# Enable gen2 execution environment
gcloud run services update maxtory-backend --execution-environment gen2 --region us-central1
```

## 🗄️ Database Commands

### Upload mtg.db to Cloud Storage
```bash
gsutil cp mtg/data/mtg.db gs://maxtory-mtg-database/
```

### Verify Upload
```bash
gsutil ls -lh gs://maxtory-mtg-database/
```

### Download mtg.db
```bash
gsutil cp gs://maxtory-mtg-database/mtg.db ./mtg/data/
```

### Update mtg.db
```bash
gsutil cp mtg/data/mtg.db gs://maxtory-mtg-database/
gcloud run services update maxtory-mtg-backend --region us-central1  # Restart to pick up changes
```

## 🔐 Secret Management

### Create Secret
```bash
echo -n "secret-value" | gcloud secrets create secret-name --data-file=-
```

### Update Secret
```bash
echo -n "new-value" | gcloud secrets versions add secret-name --data-file=-
```

### View Secret
```bash
gcloud secrets versions access latest --secret=secret-name
```

### List Secrets
```bash
gcloud secrets list
```

### Grant Access to Secret
```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding secret-name \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 🔄 Rollback Commands

### List Revisions
```bash
gcloud run revisions list --service maxtory-backend --region us-central1
```

### Rollback to Previous Revision
```bash
gcloud run services update-traffic maxtory-backend \
  --to-revisions maxtory-backend-00001-abc=100 \
  --region us-central1
```

### Gradual Rollback (Split Traffic)
```bash
# 90% to old version, 10% to new
gcloud run services update-traffic maxtory-backend \
  --to-revisions maxtory-backend-00001-abc=90,maxtory-backend-00002-def=10 \
  --region us-central1
```

## 📊 Performance Commands

### View Service Metrics
```bash
gcloud run services describe maxtory-backend --region us-central1 --format json | jq '.status.conditions'
```

### Check Instance Count
```bash
gcloud run services describe maxtory-backend --region us-central1 --format 'value(status.containerStatuses[0].imageDigest)'
```

### Test Health Endpoint
```bash
BACKEND_URL=$(gcloud run services describe maxtory-backend --region us-central1 --format 'value(status.url)')
curl $BACKEND_URL/health
```

### Load Test
```bash
# Using Apache Bench
ab -n 1000 -c 10 https://maxtory-backend-xxx.run.app/health

# Using wrk
wrk -t4 -c100 -d30s https://maxtory-backend-xxx.run.app/health
```

## 🌐 Domain Mapping

### Add Custom Domain
```bash
gcloud run domain-mappings create \
  --service maxtory-frontend \
  --domain maxtory.app \
  --region us-central1
```

### View Domain Mappings
```bash
gcloud run domain-mappings list --region us-central1
```

### Delete Domain Mapping
```bash
gcloud run domain-mappings delete --domain maxtory.app --region us-central1
```

## 🧹 Cleanup Commands

### Delete Service
```bash
gcloud run services delete maxtory-backend --region us-central1 --quiet
```

### Delete All Services
```bash
gcloud run services delete maxtory-backend --region us-central1 --quiet
gcloud run services delete maxtory-mtg-backend --region us-central1 --quiet
gcloud run services delete maxtory-frontend --region us-central1 --quiet
gcloud run services delete maxtory-mtg-frontend --region us-central1 --quiet
```

### Delete Images
```bash
gcloud container images delete gcr.io/$PROJECT_ID/maxtory-backend --quiet
gcloud container images delete gcr.io/$PROJECT_ID/maxtory-mtg-backend --quiet
gcloud container images delete gcr.io/$PROJECT_ID/maxtory-frontend --quiet
gcloud container images delete gcr.io/$PROJECT_ID/maxtory-mtg-frontend --quiet
```

### Delete Old Revisions (Keep Last 5)
```bash
gcloud run revisions list --service maxtory-backend --region us-central1 --sort-by=~created --limit=999 --format="value(name)" | tail -n +6 | xargs -I {} gcloud run revisions delete {} --region us-central1 --quiet
```

### Clean Up Old Images
```bash
gcloud container images list-tags gcr.io/$PROJECT_ID/maxtory-backend --format=json | jq -r '.[] | select(.timestamp.datetime < "2024-01-01") | .digest' | xargs -I {} gcloud container images delete gcr.io/$PROJECT_ID/maxtory-backend@{} --quiet
```

## 🔒 IAM Commands

### Grant User Access to Service
```bash
gcloud run services add-iam-policy-binding maxtory-backend \
  --member="user:email@example.com" \
  --role="roles/run.invoker" \
  --region us-central1
```

### Make Service Public
```bash
gcloud run services add-iam-policy-binding maxtory-backend \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --region us-central1
```

### Make Service Private
```bash
gcloud run services remove-iam-policy-binding maxtory-backend \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --region us-central1
```

## 🐛 Debugging Commands

### SSH into Running Container
```bash
# Not directly possible with Cloud Run
# Instead, deploy with Cloud Run Jobs for debugging:
gcloud run jobs create debug-job \
  --image gcr.io/$PROJECT_ID/maxtory-backend \
  --command /bin/sh \
  --region us-central1

gcloud run jobs execute debug-job --region us-central1
```

### View Container Logs with Timestamp
```bash
gcloud run services logs read maxtory-backend \
  --region us-central1 \
  --format="table(timestamp,severity,textPayload)" \
  --limit 50
```

### View Specific Time Range
```bash
gcloud run services logs read maxtory-backend \
  --region us-central1 \
  --filter="timestamp>=\"2024-01-01T00:00:00Z\" AND timestamp<=\"2024-01-02T00:00:00Z\"" \
  --limit 100
```

## 💰 Cost Commands

### View Billing for Cloud Run
```bash
# View in Cloud Console
open "https://console.cloud.google.com/billing/reports?project=$PROJECT_ID"

# Export billing data
gcloud alpha billing accounts list
gcloud alpha billing projects describe $PROJECT_ID
```

### Estimate Monthly Cost
```bash
# Based on current usage
gcloud run services describe maxtory-backend --region us-central1 --format json | jq '.status.latestReadyRevisionName'

# Check usage in Cloud Console
open "https://console.cloud.google.com/run/detail/$REGION/maxtory-backend/metrics?project=$PROJECT_ID"
```

## 🎯 Common Workflows

### Hot Fix Deployment
```bash
# 1. Build new image with fix
gcloud builds submit --tag gcr.io/$PROJECT_ID/maxtory-backend:hotfix-$(date +%s) --dockerfile=backend/Dockerfile .

# 2. Deploy without traffic
gcloud run deploy maxtory-backend --image gcr.io/$PROJECT_ID/maxtory-backend:hotfix-$(date +%s) --no-traffic --region us-central1

# 3. Test the new revision
curl https://maxtory-backend-xxx-hotfix.run.app/health

# 4. Route traffic to new revision
gcloud run services update-traffic maxtory-backend --to-latest --region us-central1
```

### Canary Deployment
```bash
# 1. Deploy canary with tag
gcloud run deploy maxtory-backend --image gcr.io/$PROJECT_ID/maxtory-backend:canary --tag canary --no-traffic --region us-central1

# 2. Route 10% traffic to canary
gcloud run services update-traffic maxtory-backend --to-tags stable=90,canary=10 --region us-central1

# 3. Monitor errors
gcloud run services logs read maxtory-backend --region us-central1 --log-filter='severity>=ERROR' --limit 20

# 4. Full rollout or rollback
gcloud run services update-traffic maxtory-backend --to-tags canary=100 --region us-central1
# OR
gcloud run services update-traffic maxtory-backend --to-tags stable=100 --region us-central1
```

### Emergency Rollback
```bash
# 1. List revisions
gcloud run revisions list --service maxtory-backend --region us-central1

# 2. Immediate rollback to previous
gcloud run services update-traffic maxtory-backend --to-revisions maxtory-backend-00001-abc=100 --region us-central1
```

## 📝 Environment Variables

### Set Environment
```bash
export PROJECT_ID=your-project-id
export REGION=us-central1
```

### Commonly Used Variables
```bash
export PROJECT_ID=$(gcloud config get-value project)
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
export REGION=us-central1
export SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
```

## 🔗 Useful Links

- Cloud Console: https://console.cloud.google.com/run?project=$PROJECT_ID
- Container Registry: https://console.cloud.google.com/gcr?project=$PROJECT_ID
- Secret Manager: https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID
- Cloud Storage: https://console.cloud.google.com/storage?project=$PROJECT_ID
- Logs: https://console.cloud.google.com/logs?project=$PROJECT_ID
- Metrics: https://console.cloud.google.com/monitoring?project=$PROJECT_ID
