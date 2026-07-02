# Enterprise Infrastructure

## Runtime Capabilities

- Redis powers cache and distributed rate limiting when `REDIS_URL` is set.
- BullMQ queues are enabled from the same Redis connection for webhook, event, retry, and maintenance jobs.
- RabbitMQ publishes topic events when `RABBITMQ_URL` and `FEATURE_RABBITMQ_EVENTS=true` are set.
- Prometheus metrics are exposed at `/metrics`.
- Kubernetes readiness is exposed at `/ready`; liveness is exposed at `/health`.
- OpenTelemetry starts when `OTEL_ENABLED=true`.
- S3 media storage is enabled with `MEDIA_STORAGE_DRIVER=s3`, `S3_BUCKET`, and `S3_REGION`.
- CDN URLs are emitted when `CDN_BASE_URL` is configured.
- Feature flags are controlled by env vars and surfaced through `/api/infrastructure/status`.
- Mutating API requests create audit logs.

## Local Production Stack

```bash
docker compose up --build
```

Services:
- API: `http://localhost:4000`
- Client: `http://localhost:5173`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`
- RabbitMQ management: `http://localhost:15672`

## Kubernetes

Apply the manifests:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.example.yaml
kubectl apply -f k8s/
```

Replace `k8s/secret.example.yaml` values before production use.

## Zero Downtime

The API deployment uses:
- `maxUnavailable: 0`
- readiness probe on `/ready`
- graceful `SIGTERM` drain
- `terminationGracePeriodSeconds: 35`
- `PodDisruptionBudget` with `minAvailable: 2`
- HPA from 3 to 12 replicas

## Required Production Environment

```env
NODE_ENV=production
MONGODB_URI=
JWT_SECRET=
REDIS_URL=
RABBITMQ_URL=
FEATURE_RABBITMQ_EVENTS=true
OTEL_ENABLED=true
MEDIA_STORAGE_DRIVER=s3
S3_BUCKET=
S3_REGION=ap-south-1
CDN_BASE_URL=
PUBLIC_BASE_URL=
```
