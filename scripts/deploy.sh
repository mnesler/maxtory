#!/bin/bash
# ============================================================================
# deploy.sh - Quick deployment script for Maxtory to Cloud Run
# ============================================================================
# Usage:
#   ./scripts/deploy.sh                    # Deploy all services
#   ./scripts/deploy.sh backend            # Deploy only backend
#   ./scripts/deploy.sh mtg-backend        # Deploy only mtg-backend
#   ./scripts/deploy.sh frontend           # Deploy only frontend
#   ./scripts/deploy.sh mtg-frontend       # Deploy only mtg-frontend
# ============================================================================

set -e  # Exit on error

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────
PROJECT_ID=${GCP_PROJECT_ID:-""}
REGION=${GCP_REGION:-"us-central1"}
SERVICE=$1

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ──────────────────────────────────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────────────────────────────────
log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check gcloud
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI not found. Please install: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi
    
    # Check docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install Docker."
        exit 1
    fi
    
    # Check project ID
    if [ -z "$PROJECT_ID" ]; then
        PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
        if [ -z "$PROJECT_ID" ]; then
            log_error "GCP_PROJECT_ID not set. Please set it or run: gcloud config set project PROJECT_ID"
            exit 1
        fi
    fi
    
    log_info "Using project: $PROJECT_ID"
    log_info "Using region: $REGION"
}

deploy_backend() {
    log_info "Deploying Backend API..."
    
    # Build
    gcloud builds submit \
        --tag gcr.io/$PROJECT_ID/maxtory-backend \
        --dockerfile=backend/Dockerfile \
        .
    
    # Deploy
    gcloud run deploy maxtory-backend \
        --image gcr.io/$PROJECT_ID/maxtory-backend \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --port 3001 \
        --memory 512Mi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 10 \
        --set-env-vars NODE_ENV=production,PORT=3001 \
        --set-secrets OPEN_ROUTER_KEY=openrouter-key:latest,GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest,GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest,JWT_SECRET=jwt-secret:latest,SESSION_SECRET=session-secret:latest
    
    BACKEND_URL=$(gcloud run services describe maxtory-backend --region $REGION --format 'value(status.url)')
    log_info "Backend API deployed: $BACKEND_URL"
}

deploy_mtg_backend() {
    log_info "Deploying MTG Backend..."
    
    # Build
    gcloud builds submit \
        --tag gcr.io/$PROJECT_ID/maxtory-mtg-backend \
        --dockerfile=mtg/Dockerfile \
        .
    
    # Deploy
    gcloud run deploy maxtory-mtg-backend \
        --image gcr.io/$PROJECT_ID/maxtory-mtg-backend \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --port 3002 \
        --memory 1Gi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 20 \
        --execution-environment gen2 \
        --add-volume name=mtg-data,type=cloud-storage,bucket=maxtory-mtg-database \
        --add-volume-mount volume=mtg-data,mount-path=/app/mtg/data \
        --set-env-vars NODE_ENV=production,MTG_PORT=3002 \
        --set-secrets OPEN_ROUTER_KEY=openrouter-key:latest
    
    MTG_BACKEND_URL=$(gcloud run services describe maxtory-mtg-backend --region $REGION --format 'value(status.url)')
    log_info "MTG Backend deployed: $MTG_BACKEND_URL"
}

deploy_frontend() {
    log_info "Deploying Frontend..."
    
    # Get backend URL
    BACKEND_URL=$(gcloud run services describe maxtory-backend --region $REGION --format 'value(status.url)' 2>/dev/null)
    if [ -z "$BACKEND_URL" ]; then
        BACKEND_URL="https://api.maxtory.app"
        log_warn "Backend not deployed yet, using default URL: $BACKEND_URL"
    fi
    
    # Build
    gcloud builds submit \
        --tag gcr.io/$PROJECT_ID/maxtory-frontend \
        --dockerfile=frontend/Dockerfile \
        --build-arg VITE_API_URL=$BACKEND_URL \
        .
    
    # Deploy
    gcloud run deploy maxtory-frontend \
        --image gcr.io/$PROJECT_ID/maxtory-frontend \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --port 8080 \
        --memory 256Mi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 10
    
    FRONTEND_URL=$(gcloud run services describe maxtory-frontend --region $REGION --format 'value(status.url)')
    log_info "Frontend deployed: $FRONTEND_URL"
}

deploy_mtg_frontend() {
    log_info "Deploying MTG Frontend..."
    
    # Get MTG backend URL
    MTG_BACKEND_URL=$(gcloud run services describe maxtory-mtg-backend --region $REGION --format 'value(status.url)' 2>/dev/null)
    if [ -z "$MTG_BACKEND_URL" ]; then
        MTG_BACKEND_URL="https://mtg-api.maxtory.app"
        log_warn "MTG Backend not deployed yet, using default URL: $MTG_BACKEND_URL"
    fi
    
    # Build
    gcloud builds submit \
        --tag gcr.io/$PROJECT_ID/maxtory-mtg-frontend \
        --dockerfile=mtg/frontend/Dockerfile \
        --build-arg VITE_MTG_API_URL=$MTG_BACKEND_URL \
        .
    
    # Deploy
    gcloud run deploy maxtory-mtg-frontend \
        --image gcr.io/$PROJECT_ID/maxtory-mtg-frontend \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --port 8080 \
        --memory 256Mi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 10
    
    MTG_FRONTEND_URL=$(gcloud run services describe maxtory-mtg-frontend --region $REGION --format 'value(status.url)')
    log_info "MTG Frontend deployed: $MTG_FRONTEND_URL"
}

show_urls() {
    echo ""
    log_info "Deployment Summary:"
    echo "──────────────────────────────────────────────────────────"
    
    BACKEND_URL=$(gcloud run services describe maxtory-backend --region $REGION --format 'value(status.url)' 2>/dev/null || echo "Not deployed")
    echo "Backend API:      $BACKEND_URL"
    
    MTG_BACKEND_URL=$(gcloud run services describe maxtory-mtg-backend --region $REGION --format 'value(status.url)' 2>/dev/null || echo "Not deployed")
    echo "MTG Backend:      $MTG_BACKEND_URL"
    
    FRONTEND_URL=$(gcloud run services describe maxtory-frontend --region $REGION --format 'value(status.url)' 2>/dev/null || echo "Not deployed")
    echo "Frontend:         $FRONTEND_URL"
    
    MTG_FRONTEND_URL=$(gcloud run services describe maxtory-mtg-frontend --region $REGION --format 'value(status.url)' 2>/dev/null || echo "Not deployed")
    echo "MTG Frontend:     $MTG_FRONTEND_URL"
    
    echo "──────────────────────────────────────────────────────────"
}

# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────
main() {
    check_prerequisites
    
    case "$SERVICE" in
        backend)
            deploy_backend
            ;;
        mtg-backend)
            deploy_mtg_backend
            ;;
        frontend)
            deploy_frontend
            ;;
        mtg-frontend)
            deploy_mtg_frontend
            ;;
        "")
            log_info "Deploying all services..."
            deploy_backend
            deploy_mtg_backend
            deploy_frontend
            deploy_mtg_frontend
            ;;
        *)
            log_error "Unknown service: $SERVICE"
            echo "Usage: $0 [backend|mtg-backend|frontend|mtg-frontend]"
            exit 1
            ;;
    esac
    
    show_urls
    log_info "Deployment complete!"
}

main
