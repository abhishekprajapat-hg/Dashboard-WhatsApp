# Deployment Guide

## Local Production Stack

```bash
npm ci
npm run build
npm run check:server
npm test
docker compose up --build
```

## Required Environment

```env
NODE_ENV=production
PORT=4000
MONGODB_URI=
JWT_SECRET=
CORS_ORIGINS=https://app.example.com
PUBLIC_BASE_URL=https://api.example.com
REDIS_URL=
RABBITMQ_URL=
FEATURE_RABBITMQ_EVENTS=true
MEDIA_STORAGE_DRIVER=s3
S3_BUCKET=
S3_REGION=ap-south-1
CDN_BASE_URL=
OTEL_ENABLED=true
```

## Kubernetes

1. Build and push images.
2. Create namespace.
3. Create production secret from `k8s/secret.example.yaml`.
4. Apply manifests:

```bash
kubectl apply -f k8s/
kubectl rollout status deployment/whatscrm-api -n whatscrm
```

## Zero Downtime

- Deployment uses rolling update with `maxUnavailable: 0`.
- Readiness probe removes pods before traffic.
- API drains on `SIGTERM`.
- PodDisruptionBudget keeps at least two pods available.

## Rollback

```bash
kubectl rollout undo deployment/whatscrm-api -n whatscrm
```
