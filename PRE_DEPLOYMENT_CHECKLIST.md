# Pre-Deployment Checklist

Before deploying to GCP Cloud Run, ensure all prerequisites are met and configurations are correct.

## ☑️ Prerequisites

### Local Environment
- [ ] **gcloud CLI installed** - `gcloud --version`
- [ ] **Docker installed** - `docker --version`
- [ ] **Git configured** - `git --version`
- [ ] **Node.js 20+ installed** - `node --version`
- [ ] **npm installed** - `npm --version`

### GCP Setup
- [ ] **GCP Account created** with billing enabled
- [ ] **Project created** - `gcloud projects list`
- [ ] **Project ID set** - `export PROJECT_ID=your-project-id`
- [ ] **Default region set** - `gcloud config set run/region us-central1`
- [ ] **Billing enabled** - Check Cloud Console

### Required APIs
Enable all required APIs:
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage-api.googleapis.com \
  storage-component.googleapis.com
```

- [ ] **Cloud Run API enabled**
- [ ] **Cloud Build API enabled**
- [ ] **Container Registry API enabled**
- [ ] **Secret Manager API enabled**
- [ ] **Cloud Storage API enabled**

## ☑️ Configuration Files

### Environment Variables
- [ ] **.env file created** (for local development)
- [ ] **OPEN_ROUTER_KEY set** in .env
- [ ] **OAuth credentials obtained** (GitHub, Google)
- [ ] **All required secrets documented**

### Docker Configuration
- [ ] **.dockerignore created** (✓ already created)
- [ ] **docker-compose.yml created** (✓ already created)
- [ ] **All Dockerfiles created** (✓ backend, mtg, frontend, mtg/frontend)

### Deployment Configuration
- [ ] **cloudbuild.yaml created** (✓ already created)
- [ ] **GitHub Actions workflow created** (✓ already created)
- [ ] **scripts/deploy.sh executable** - `chmod +x scripts/deploy.sh`

## ☑️ Secrets Setup

Create all secrets in GCP Secret Manager:

```bash
# OpenRouter API key (required)
echo -n "YOUR_OPENROUTER_KEY" | gcloud secrets create openrouter-key --data-file=-

# GitHub OAuth (required for auth)
echo -n "YOUR_GITHUB_CLIENT_ID" | gcloud secrets create github-client-id --data-file=-
echo -n "YOUR_GITHUB_CLIENT_SECRET" | gcloud secrets create github-client-secret --data-file=-

# Google OAuth (required for auth)
echo -n "YOUR_GOOGLE_CLIENT_ID" | gcloud secrets create google-client-id --data-file=-
echo -n "YOUR_GOOGLE_CLIENT_SECRET" | gcloud secrets create google-client-secret --data-file=-

# JWT and Session secrets (auto-generated)
echo -n "$(openssl rand -hex 32)" | gcloud secrets create jwt-secret --data-file=-
echo -n "$(openssl rand -hex 32)" | gcloud secrets create session-secret --data-file=-
```

Checklist:
- [ ] **openrouter-key created**
- [ ] **github-client-id created**
- [ ] **github-client-secret created**
- [ ] **google-client-id created**
- [ ] **google-client-secret created**
- [ ] **jwt-secret created**
- [ ] **session-secret created**

Grant access to secrets:
```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in openrouter-key github-client-id github-client-secret google-client-id google-client-secret jwt-secret session-secret; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
done
```

- [ ] **IAM permissions granted** for all secrets

## ☑️ Database Setup

### MTG Database (315MB)
```bash
# Create Cloud Storage bucket
gsutil mb -p $PROJECT_ID -c STANDARD -l us-central1 gs://maxtory-mtg-database/

# Upload mtg.db
gsutil cp mtg/data/mtg.db gs://maxtory-mtg-database/

# Grant read access
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gsutil iam ch serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com:objectViewer gs://maxtory-mtg-database/

# Verify upload
gsutil ls -lh gs://maxtory-mtg-database/
```

- [ ] **Cloud Storage bucket created** (`maxtory-mtg-database`)
- [ ] **mtg.db uploaded** (verify 315MB size)
- [ ] **Read permissions granted**

### Users Database
- [ ] **users.db path configured** in backend code
- [ ] **Migration plan documented** (SQLite → Firestore)

## ☑️ Local Testing

Test all services locally before deploying:

```bash
# Start all services
docker-compose up

# Test endpoints
curl http://localhost:3001/health  # Backend API
curl http://localhost:3002/api/health  # MTG Backend
open http://localhost:3000  # Frontend
open http://localhost:5174  # MTG Frontend
```

- [ ] **Backend API health check passes**
- [ ] **MTG Backend health check passes**
- [ ] **Frontend loads correctly**
- [ ] **MTG Frontend loads correctly**
- [ ] **Frontend can call Backend API**
- [ ] **MTG Frontend can call MTG Backend**
- [ ] **OAuth flow works locally** (optional)
- [ ] **WebSocket connection works** (optional)

### Test Build Process
```bash
# Build all images
docker build -t test-backend -f backend/Dockerfile .
docker build -t test-mtg-backend -f mtg/Dockerfile .
docker build -t test-frontend -f frontend/Dockerfile --build-arg VITE_API_URL=http://localhost:3001 .
docker build -t test-mtg-frontend -f mtg/frontend/Dockerfile --build-arg VITE_MTG_API_URL=http://localhost:3002 .

# Check image sizes
docker images | grep test-
```

- [ ] **All images build successfully**
- [ ] **No build errors or warnings**
- [ ] **Image sizes are reasonable** (backend ~150MB, frontend ~80MB)

## ☑️ GitHub Setup (for CI/CD)

### Option A: Workload Identity Federation (Recommended)
```bash
# Create Workload Identity Pool
gcloud iam workload-identity-pools create github-actions \
  --location=global \
  --description="GitHub Actions Pool"

# Create provider
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github-actions \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository_owner=='YOUR_GITHUB_USERNAME'"

# Create service account
gcloud iam service-accounts create github-actions-sa \
  --display-name="GitHub Actions Service Account"

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Bind Workload Identity
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/attribute.repository/YOUR_GITHUB_USERNAME/maxtory"
```

- [ ] **Workload Identity Pool created**
- [ ] **Workload Identity Provider created**
- [ ] **Service account created**
- [ ] **IAM permissions granted**
- [ ] **Workload Identity bound**

### GitHub Secrets
Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

- [ ] **GCP_PROJECT_ID**: Your GCP project ID
- [ ] **WIF_PROVIDER**: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github`
- [ ] **WIF_SERVICE_ACCOUNT**: `github-actions-sa@PROJECT_ID.iam.gserviceaccount.com`

## ☑️ Pre-Deployment Verification

### Code Quality
- [ ] **All tests passing** - `npm test`
- [ ] **No TypeScript errors** - `npm run build`
- [ ] **No linting errors** (if configured)
- [ ] **Dependencies up to date** - `npm audit`

### Documentation
- [ ] **README.md updated** with deployment info
- [ ] **API endpoints documented**
- [ ] **Environment variables documented**
- [ ] **Deployment guide reviewed**

### Security
- [ ] **No secrets in code** - `git log -p | grep -i "secret\|password\|key"`
- [ ] **No .env files in git** - Check .gitignore
- [ ] **.dockerignore configured** to exclude sensitive files
- [ ] **OAuth redirect URIs updated** with Cloud Run URLs
- [ ] **CORS configured** with correct origins

### Performance
- [ ] **Docker images optimized** (multi-stage builds)
- [ ] **Static assets compressed** (gzip enabled)
- [ ] **Health checks implemented** in all services
- [ ] **Graceful shutdown handling** (SIGTERM)

## ☑️ First Deployment

### Deploy Backend First
```bash
./scripts/deploy.sh backend
```

- [ ] **Backend API deployed successfully**
- [ ] **Health endpoint accessible** - `curl BACKEND_URL/health`
- [ ] **No errors in logs** - `gcloud run services logs read maxtory-backend --region us-central1 --limit 20`
- [ ] **Service URL noted** for frontend configuration

### Deploy MTG Backend
```bash
./scripts/deploy.sh mtg-backend
```

- [ ] **MTG Backend deployed successfully**
- [ ] **Health endpoint accessible** - `curl MTG_BACKEND_URL/api/health`
- [ ] **Database accessible** (check logs for mtg.db connection)
- [ ] **No errors in logs**
- [ ] **Service URL noted** for frontend configuration

### Deploy Frontends
```bash
# Update API URLs in build commands first
./scripts/deploy.sh frontend
./scripts/deploy.sh mtg-frontend
```

- [ ] **Frontend deployed successfully**
- [ ] **Static files served correctly**
- [ ] **Can reach backend API**
- [ ] **MTG Frontend deployed successfully**
- [ ] **Can reach MTG backend**

## ☑️ Post-Deployment Verification

### Functional Testing
- [ ] **Backend health check** - `curl https://maxtory-backend-xxx.run.app/health`
- [ ] **MTG Backend health check** - `curl https://maxtory-mtg-backend-xxx.run.app/api/health`
- [ ] **Frontend loads** - Open in browser
- [ ] **MTG Frontend loads** - Open in browser
- [ ] **Frontend → Backend API works**
- [ ] **MTG Frontend → MTG Backend works**
- [ ] **OAuth login works** (GitHub, Google)
- [ ] **WebSocket connection works**
- [ ] **MTG card search works**
- [ ] **Deck analysis works**

### Performance Testing
- [ ] **Cold start time < 5 seconds**
- [ ] **Response time acceptable** (< 1s for most requests)
- [ ] **No memory leaks** (monitor over time)
- [ ] **Concurrent requests handled** (load test)

### Monitoring
- [ ] **Logs visible in Cloud Console**
- [ ] **Metrics showing data**
- [ ] **Error tracking enabled**
- [ ] **Alerts configured** (optional)

## ☑️ Domain Mapping (Optional)

If using custom domains:

```bash
# Map domains
gcloud run domain-mappings create --service maxtory-frontend --domain maxtory.app --region us-central1
gcloud run domain-mappings create --service maxtory-backend --domain api.maxtory.app --region us-central1
gcloud run domain-mappings create --service maxtory-mtg-frontend --domain mtg.maxtory.app --region us-central1
gcloud run domain-mappings create --service maxtory-mtg-backend --domain mtg-api.maxtory.app --region us-central1
```

- [ ] **DNS records configured** (A/CNAME)
- [ ] **SSL certificates provisioned** (automatic with Cloud Run)
- [ ] **Custom domains verified**
- [ ] **OAuth redirect URIs updated** with custom domains
- [ ] **CORS updated** with custom domains

## ☑️ CI/CD Setup

### Test GitHub Actions
```bash
# Trigger workflow
git add .
git commit -m "test: trigger deployment"
git push origin main
```

- [ ] **Workflow triggers on push to main**
- [ ] **All build steps succeed**
- [ ] **All deploy steps succeed**
- [ ] **Service URLs updated**
- [ ] **No errors in workflow logs**

### Monitor Deployment
- [ ] **Check GitHub Actions tab** for build status
- [ ] **Verify Cloud Build** shows successful builds
- [ ] **Check Cloud Run** for new revisions
- [ ] **Test deployed services** after automated deployment

## ☑️ Final Checks

### Documentation
- [ ] **Deployment guide accessible** to team
- [ ] **Service URLs documented**
- [ ] **Rollback procedure documented**
- [ ] **On-call procedures defined**

### Backup & Recovery
- [ ] **Database backup strategy** in place
- [ ] **Rollback tested** at least once
- [ ] **Disaster recovery plan** documented

### Cost Management
- [ ] **Budget alerts configured**
- [ ] **Cost estimation documented** (~$20-50/month)
- [ ] **Resource limits set** (max instances)

### Security
- [ ] **IAM permissions reviewed**
- [ ] **Secrets access audited**
- [ ] **Public access appropriate** (frontend yes, backend maybe)
- [ ] **Rate limiting considered** (optional)

## 🎉 Ready to Deploy!

If all checkboxes are checked, you're ready to deploy:

```bash
# Deploy all services
./scripts/deploy.sh

# Or use Cloud Build
gcloud builds submit --config=cloudbuild.yaml .

# Or use GitHub Actions
git push origin main
```

## 📞 Support

If you encounter issues:

1. **Check logs**: `gcloud run services logs read SERVICE_NAME --region us-central1 --limit 50`
2. **Review documentation**: See DEPLOYMENT_GUIDE.md
3. **Test locally**: `docker-compose up`
4. **Check Cloud Console**: https://console.cloud.google.com/run

## 🔄 Rollback Plan

If deployment fails:

```bash
# List revisions
gcloud run revisions list --service maxtory-backend --region us-central1

# Rollback
gcloud run services update-traffic maxtory-backend \
  --to-revisions PREVIOUS_REVISION=100 \
  --region us-central1
```

---

**Last Updated**: February 28, 2026
**Status**: Ready for deployment
