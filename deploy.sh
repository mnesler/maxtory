#!/bin/bash
# ============================================================================
# Maxtory Deployment Script for GCP Cloud Run
# ============================================================================
# This script deploys all 4 services to Google Cloud Run
# Usage: ./deploy.sh
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="maxtory"
REGION="us-central1"
REGISTRY="${REGION}-docker.pkg.dev"

# Print banner
echo -e "${CYAN}"
echo "═══════════════════════════════════════════════════════════════════"
echo "   M A X T O R Y   D E P L O Y M E N T"
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${NC}"

# Step 1: Enable required APIs
echo -e "${BLUE}▸ Step 1: Enabling required GCP APIs...${NC}"
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project=${PROJECT_ID}
echo -e "${GREEN}✓ APIs enabled${NC}"

# Step 2: Create Artifact Registry repository
echo -e "${BLUE}▸ Step 2: Creating Artifact Registry repository...${NC}"
gcloud artifacts repositories create maxtory \
  --repository-format=docker \
  --location=${REGION} \
  --description="Docker images for Maxtory app" \
  --project=${PROJECT_ID} 2>/dev/null || echo -e "${YELLOW}✓ Repository already exists${NC}"
echo -e "${GREEN}✓ Artifact Registry ready${NC}"

# Step 3: Get service account and grant secret access
echo -e "${BLUE}▸ Step 3: Configuring Secret Manager access...${NC}"
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant access to each secret
for SECRET in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET JWT_SECRET OPENROUTER_API_KEY; do
  gcloud secrets add-iam-policy-binding ${SECRET} \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" \
    --project=${PROJECT_ID} 2>/dev/null || echo -e "${YELLOW}  - ${SECRET} already configured${NC}"
done
echo -e "${GREEN}✓ Secret access configured${NC}"

# Function to deploy a service
deploy_service() {
  local SERVICE_NAME=$1
  local DOCKERFILE_PATH=$2
  local MEMORY=$3
  local PORTS=$4
  local SECRETS=$5
  
  echo -e "${BLUE}▸ Deploying ${SERVICE_NAME}...${NC}"
  
  # Build with Cloud Build and deploy
  if [ -n "${SECRETS}" ]; then
    gcloud builds submit \
      --config=- \
      --substitutions=_SERVICE_NAME=${SERVICE_NAME},_MEMORY=${MEMORY},_PORT=${PORTS} \
      --project=${PROJECT_ID} \
      --quiet \
      <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest', '-f', '${DOCKERFILE_PATH}', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - '${SERVICE_NAME}'
      - '--image'
      - '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest'
      - '--region'
      - '${REGION}'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--memory'
      - '${MEMORY}'
      - '--cpu'
      - '1'
      - '--max-instances'
      - '10'
      - '--min-instances'
      - '0'
      - '--timeout'
      - '3600'
      - '--execution-environment'
      - 'gen2'
      - '--port'
      - '${PORTS}'
      - '--set-secrets'
      - '${SECRETS}'
images:
  - '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest'
EOF
  else
    gcloud builds submit \
      --config=- \
      --substitutions=_SERVICE_NAME=${SERVICE_NAME},_MEMORY=${MEMORY},_PORT=${PORTS} \
      --project=${PROJECT_ID} \
      --quiet \
      <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest', '-f', '${DOCKERFILE_PATH}', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - '${SERVICE_NAME}'
      - '--image'
      - '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest'
      - '--region'
      - '${REGION}'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--memory'
      - '${MEMORY}'
      - '--cpu'
      - '1'
      - '--max-instances'
      - '10'
      - '--min-instances'
      - '0'
      - '--timeout'
      - '3600'
      - '--execution-environment'
      - 'gen2'
      - '--port'
      - '${PORTS}'
images:
  - '${REGISTRY}/${PROJECT_ID}/maxtory/${SERVICE_NAME}:latest'
EOF
  fi
  
  # Get the service URL
  local URL=$(gcloud run services describe ${SERVICE_NAME} \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --format='value(status.url)')
    
  echo -e "${GREEN}✓ ${SERVICE_NAME} deployed: ${URL}${NC}"
  echo "${SERVICE_NAME}:${URL}" >> /tmp/maxtory_urls.txt
}

# Step 4: Deploy Backend (OAuth + Attractor)
echo ""
deploy_service "backend" "backend/Dockerfile" "512Mi" "3000" \
  "GITHUB_CLIENT_ID=GITHUB_CLIENT_ID:latest,GITHUB_CLIENT_SECRET=GITHUB_CLIENT_SECRET:latest,JWT_SECRET=JWT_SECRET:latest"

# Get backend URL
BACKEND_URL=$(gcloud run services describe backend --region ${REGION} --project ${PROJECT_ID} --format 'value(status.url)')

# Step 5: Deploy MTG Backend
echo ""
deploy_service "mtg-backend" "mtg/Dockerfile" "1Gi" "3002" \
  "OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest"

# Step 6: Deploy MTG Frontend with backend URL
echo ""
gcloud builds submit \
  --config=- \
  --substitutions=_SERVICE_NAME=mtg-frontend,_MEMORY=256Mi,_PORT=8080,_BACKEND_URL=${BACKEND_URL} \
  --project=${PROJECT_ID} \
  --quiet \
  <<'EOF'
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'us-central1-docker.pkg.dev/maxtory/maxtory/mtg-frontend:latest', '-f', 'mtg/frontend/Dockerfile', '--build-arg', 'VITE_API_URL=https://mtg-backend-uc.a.run.app', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'us-central1-docker.pkg.dev/maxtory/maxtory/mtg-frontend:latest']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'mtg-frontend'
      - '--image'
      - 'us-central1-docker.pkg.dev/maxtory/maxtory/mtg-frontend:latest'
      - '--region'
      - 'us-central1'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--memory'
      - '256Mi'
      - '--cpu'
      - '1'
      - '--max-instances'
      - '10'
      - '--min-instances'
      - '0'
      - '--timeout'
      - '3600'
      - '--execution-environment'
      - 'gen2'
      - '--port'
      - '8080'
images:
  - 'us-central1-docker.pkg.dev/maxtory/maxtory/mtg-frontend:latest'
EOF

MTG_FRONTEND_URL=$(gcloud run services describe mtg-frontend --region ${REGION} --project ${PROJECT_ID} --format 'value(status.url)')
echo -e "${GREEN}✓ mtg-frontend deployed: ${MTG_FRONTEND_URL}${NC}"
echo "mtg-frontend:${MTG_FRONTEND_URL}" >> /tmp/maxtory_urls.txt

# Step 7: Deploy Attractor Frontend
echo ""
deploy_service "frontend" "frontend/Dockerfile" "256Mi" "8080" ""

# Step 8: Update backend with frontend URL
echo ""
echo -e "${BLUE}▸ Updating backend with frontend URL...${NC}"
gcloud run services update backend \
  --region=${REGION} \
  --project=${PROJECT_ID} \
  --set-env-vars="FRONTEND_URL=${MTG_FRONTEND_URL}" \
  --quiet
echo -e "${GREEN}✓ Backend updated with FRONTEND_URL${NC}"

# Final summary
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   D E P L O Y M E N T   C O M P L E T E !${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📋 Service URLs:${NC}"

while IFS=: read -r name url; do
  echo -e "  • ${name}: ${url}"
done < /tmp/maxtory_urls.txt

echo ""
echo -e "${YELLOW}⚠️  NEXT STEPS:${NC}"
echo -e "  1. Update GitHub OAuth callback URL to:"
echo -e "     ${BACKEND_URL}/auth/github/callback"
echo ""
echo -e "  2. Test OAuth flow at: ${MTG_FRONTEND_URL}"
echo ""

# Cleanup
rm -f /tmp/maxtory_urls.txt

echo -e "${GREEN}🚀 All done!${NC}"