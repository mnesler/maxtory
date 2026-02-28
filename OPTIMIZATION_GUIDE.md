# Cloud Run Optimization Guide

## Image Size Optimization

### Current Strategy
All Dockerfiles use multi-stage builds to minimize final image size:

1. **Base stage**: Install build dependencies
2. **Deps stage**: Install all dependencies
3. **Builder stage**: Compile TypeScript
4. **Prod-deps stage**: Install only production dependencies
5. **Production stage**: Copy only runtime artifacts

### Measuring Image Sizes

```bash
# Build all images
docker build -t maxtory-backend -f backend/Dockerfile .
docker build -t maxtory-mtg-backend -f mtg/Dockerfile .
docker build -t maxtory-frontend -f frontend/Dockerfile .
docker build -t maxtory-mtg-frontend -f mtg/frontend/Dockerfile .

# Check sizes
docker images | grep maxtory

# Expected sizes:
# maxtory-backend       ~150MB
# maxtory-mtg-backend   ~160MB
# maxtory-frontend      ~80MB
# maxtory-mtg-frontend  ~85MB
```

### Further Optimization

#### 1. Use Distroless Images (Advanced)

```dockerfile
# Replace: FROM node:20-alpine AS production
# With:
FROM gcr.io/distroless/nodejs20-debian11 AS production

# Benefits:
# - Even smaller (~40MB base vs ~120MB alpine)
# - More secure (no shell, no package manager)
# - Drawback: Harder to debug (no shell access)
```

#### 2. Remove Source Maps in Production

```dockerfile
# In builder stage, add:
ENV NODE_ENV=production
RUN npm run build && rm -rf **/*.map
```

#### 3. Use .dockerignore Aggressively

Already configured in `.dockerignore`, but verify:
```bash
# Check what's being sent to Docker daemon
docker build --no-cache --progress=plain -f backend/Dockerfile . 2>&1 | grep "COPY"
```

## Cold Start Optimization

### Current Strategy
- Alpine base images (fast to pull)
- Production-only dependencies (smaller)
- Health checks configured
- Min instances = 0 (cost optimization)

### Reduce Cold Starts

#### 1. Enable Minimum Instances (Costs More)

```bash
# Keep 1 instance always warm
gcloud run services update maxtory-backend \
  --min-instances 1 \
  --region us-central1

# Cost: ~$10-20/month per service
# Benefit: 0-second cold starts
```

#### 2. CPU Always Allocated (Faster Response)

```bash
# Allocate CPU even when not handling requests
gcloud run services update maxtory-backend \
  --cpu-throttling \
  --no-cpu-throttling \
  --region us-central1

# Benefit: Faster response to requests
# Cost: Higher (CPU always billed)
```

#### 3. Startup CPU Boost (Gen2 only)

```bash
gcloud run services update maxtory-backend \
  --execution-environment gen2 \
  --cpu-boost \
  --region us-central1

# Benefit: Extra CPU during startup
# No additional cost
```

## Database Performance

### MTG Database (315MB SQLite)

#### Current Strategy: Cloud Storage FUSE Mount
- Mounted as read-only volume
- Fast random access
- Shared across instances

#### Alternative 1: Cloud SQL with Cloud SQL Proxy

```yaml
# Pros:
# - Automatic backups
# - Better performance for writes
# - Scalable

# Cons:
# - More expensive (~$10-50/month)
# - Migration effort

# Setup:
gcloud sql instances create maxtory-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1
```

#### Alternative 2: Firestore (for users.db)

```typescript
// Migrate users.db to Firestore
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

// Users collection
const usersRef = db.collection('users');
await usersRef.doc(userId).set({
  email: 'user@example.com',
  createdAt: new Date(),
});

// Benefits:
// - Serverless (scales automatically)
// - Real-time sync
// - Free tier: 50k reads, 20k writes/day
```

### Caching Strategy

```typescript
// backend/src/api/server.ts
import { LRUCache } from 'lru-cache';

// Cache frequently accessed data
const cache = new LRUCache<string, any>({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
});

app.get('/api/data/:id', async (req, res) => {
  const cacheKey = `data:${req.params.id}`;
  
  // Check cache first
  let data = cache.get(cacheKey);
  if (!data) {
    data = await fetchFromDatabase(req.params.id);
    cache.set(cacheKey, data);
  }
  
  res.json(data);
});
```

## Network Optimization

### 1. Enable Cloud CDN for Frontends

```bash
# Deploy frontends with CDN
gcloud compute backend-buckets create maxtory-frontend-bucket \
  --gcs-bucket-name=maxtory-frontend-static \
  --enable-cdn

# Benefits:
# - Faster global access
# - Reduced egress costs
# - Better cache hit rates
```

### 2. Use HTTP/2 and gRPC

Cloud Run natively supports HTTP/2. For service-to-service communication:

```typescript
// Use HTTP/2 for backend-to-backend calls
import http2 from 'http2';

const client = http2.connect('https://maxtory-mtg-backend-xxx.run.app');
const req = client.request({ ':path': '/api/cards' });
```

### 3. Compression

Already configured in nginx for frontends:
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;
```

For backends, add middleware:
```typescript
import compression from 'compression';
app.use(compression());
```

## Memory Optimization

### Current Allocation
- Backend: 512Mi
- MTG Backend: 1Gi (needs more for embeddings)
- Frontends: 256Mi

### Monitoring Memory Usage

```bash
# Check actual memory usage
gcloud run services describe maxtory-backend \
  --region us-central1 \
  --format 'value(status.containerStatuses[0].resourcesUsed.memory)'

# Right-size based on actual usage
# If using < 70%, reduce memory
# If using > 90%, increase memory
```

### Memory Leak Detection

```typescript
// backend/src/index.ts
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const usage = process.memoryUsage();
    console.log({
      rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(usage.external / 1024 / 1024)}MB`,
    });
  }, 60000); // Every minute
}
```

## Request Concurrency

### Current Settings
- Backend/MTG Backend: 80 concurrent requests
- Frontends: 1000 concurrent requests (static files)

### Tuning Concurrency

```bash
# High concurrency = More efficient but needs more memory
# Low concurrency = More instances but better isolation

# Increase for CPU-bound workloads
gcloud run services update maxtory-backend \
  --concurrency 100 \
  --region us-central1

# Decrease for memory-intensive workloads
gcloud run services update maxtory-mtg-backend \
  --concurrency 50 \
  --region us-central1
```

## Logging and Monitoring

### Structured Logging

```typescript
// Use structured logs for better querying
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'maxtory-backend' },
  transports: [new transports.Console()],
});

logger.info('User logged in', {
  userId: '123',
  method: 'google',
  ip: req.ip,
});
```

### Custom Metrics

```typescript
// Export custom metrics to Cloud Monitoring
import { MetricServiceClient } from '@google-cloud/monitoring';

const client = new MetricServiceClient();

async function recordMetric(metricType: string, value: number) {
  const dataPoint = {
    interval: {
      endTime: { seconds: Date.now() / 1000 },
    },
    value: { doubleValue: value },
  };
  
  await client.createTimeSeries({
    name: client.projectPath(process.env.GCP_PROJECT_ID),
    timeSeries: [{
      metric: { type: metricType },
      points: [dataPoint],
    }],
  });
}
```

### Error Tracking with Cloud Error Reporting

```typescript
import { ErrorReporting } from '@google-cloud/error-reporting';

const errors = new ErrorReporting();

app.use((err, req, res, next) => {
  errors.report(err);
  res.status(500).json({ error: 'Internal server error' });
});
```

## Cost Optimization

### Current Estimated Costs
- **Cloud Run**: $15-30/month (low traffic)
- **Cloud Storage**: $0.02/month (mtg.db)
- **Container Registry**: $0.05/month
- **Secret Manager**: $0.18/month
- **Total**: ~$20-50/month

### Reduce Costs

#### 1. Use Cloud Run Jobs for Batch Processing

```bash
# For data ingestion, use Cloud Run Jobs instead of always-on services
gcloud run jobs create mtg-ingest \
  --image gcr.io/$PROJECT_ID/maxtory-mtg-backend \
  --command npm run ingest:scryfall \
  --region us-central1

# Run manually or on schedule
gcloud run jobs execute mtg-ingest --region us-central1
```

#### 2. Set Request Timeout

```bash
# Reduce timeout for faster failure (default 300s)
gcloud run services update maxtory-frontend \
  --timeout 60 \
  --region us-central1

# Long timeouts = more billable time
```

#### 3. Use Cloud Scheduler for Periodic Tasks

```bash
# Instead of keeping service running, invoke periodically
gcloud scheduler jobs create http cleanup-task \
  --schedule="0 2 * * *" \
  --uri="https://maxtory-backend-xxx.run.app/api/cleanup" \
  --http-method=POST
```

## Security Best Practices

### 1. Use Binary Authorization

```bash
# Only deploy signed images
gcloud run services update maxtory-backend \
  --binary-authorization=default \
  --region us-central1
```

### 2. Enable VPC Connector for Database Access

```bash
# Create VPC connector
gcloud compute networks vpc-access connectors create maxtory-connector \
  --region us-central1 \
  --network default \
  --range 10.8.0.0/28

# Use connector in Cloud Run
gcloud run services update maxtory-backend \
  --vpc-connector maxtory-connector \
  --region us-central1
```

### 3. Use Cloud Armor for DDoS Protection

```bash
# Create security policy
gcloud compute security-policies create maxtory-policy \
  --description "Maxtory DDoS protection"

# Add rate limiting rule
gcloud compute security-policies rules create 1000 \
  --security-policy maxtory-policy \
  --expression "true" \
  --action "rate-based-ban" \
  --rate-limit-threshold-count 100 \
  --rate-limit-threshold-interval-sec 60 \
  --ban-duration-sec 600
```

## Deployment Strategies

### 1. Blue-Green Deployment

```bash
# Deploy new version without traffic
gcloud run deploy maxtory-backend-v2 \
  --image gcr.io/$PROJECT_ID/maxtory-backend:v2 \
  --region us-central1 \
  --no-traffic

# Test the new version
curl https://maxtory-backend-v2-xxx.run.app/health

# Gradually shift traffic
gcloud run services update-traffic maxtory-backend \
  --to-revisions LATEST=10,PREVIOUS=90

# Full cutover
gcloud run services update-traffic maxtory-backend \
  --to-latest
```

### 2. Canary Deployment

```bash
# Tag revisions
gcloud run services update-traffic maxtory-backend \
  --to-tags stable=maxtory-backend-00001-abc \
  --region us-central1

# Deploy canary
gcloud run deploy maxtory-backend \
  --image gcr.io/$PROJECT_ID/maxtory-backend:canary \
  --tag canary \
  --no-traffic

# Route 5% to canary
gcloud run services update-traffic maxtory-backend \
  --to-tags stable=95,canary=5
```

## Testing

### Load Testing with Artillery

```yaml
# artillery.yml
config:
  target: https://maxtory-backend-xxx.run.app
  phases:
    - duration: 60
      arrivalRate: 10
      name: Warm up
    - duration: 120
      arrivalRate: 50
      name: Ramp up
    - duration: 60
      arrivalRate: 100
      name: Sustained load

scenarios:
  - name: Health check
    flow:
      - get:
          url: /health
      - think: 1
```

```bash
# Run load test
npm install -g artillery
artillery run artillery.yml
```

### Chaos Engineering

```bash
# Test failure scenarios
# 1. Kill random instances
gcloud run services delete maxtory-backend-xxx --region us-central1

# 2. Simulate high latency
# Add artificial delay in code:
app.use((req, res, next) => {
  if (Math.random() < 0.1) {
    setTimeout(next, 5000); // 10% requests delayed 5s
  } else {
    next();
  }
});

# 3. Simulate database unavailability
# Temporarily deny Cloud Storage access
```

## Monitoring Dashboard

Create a custom dashboard in Cloud Console:

```bash
# Key metrics to monitor:
# - Request count (per service)
# - Request latency (p50, p95, p99)
# - Error rate (4xx, 5xx)
# - Instance count (active instances)
# - CPU utilization
# - Memory utilization
# - Cold start count
# - Billable time

# Set up alerts:
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High Error Rate" \
  --condition-display-name="Error rate > 5%" \
  --condition-threshold-value=0.05 \
  --condition-threshold-duration=300s
```

## Next-Level Optimizations

1. **Migrate to Cloud Run Gen2** (already configured for MTG backend)
2. **Use Cloud Memorystore (Redis)** for distributed caching
3. **Implement GraphQL** for efficient data fetching
4. **Use WebAssembly** for compute-intensive tasks
5. **Enable Cloud Trace** for distributed tracing
6. **Use Cloud Profiler** to find performance bottlenecks
7. **Implement request coalescing** to reduce duplicate work
8. **Use Edge Functions** (Cloud Functions) for global latency reduction
