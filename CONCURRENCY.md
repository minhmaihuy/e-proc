# E-Audit Platform - Updated Tech Stack for 20-30 Concurrent Users

## Issues & Solutions

### 1. Database - Currently using sql.js (NOT suitable)
**Problem:** sql.js is in-memory, synchronous, doesn't handle concurrent writes well
**Solution:** Use PostgreSQL with pg-pool for connection pooling

### 2. Queue - Currently falls back to sync
**Problem:** BullMQ tries to connect to Redis, fails, falls back to sync processing
**Solution:** Make Redis optional, use in-memory queue fallback properly

### 3. Missing optimizations
- No connection pooling
- No rate limiting
- No request caching
- No load balancing considerations

## Recommended .env additions:

```
# Database (for 20-30 concurrent)
DATABASE_URL=postgresql://user:pass@localhost:5432/eaudit
DB_POOL_MIN=5
DB_POOL_MAX=20

# Redis (for Queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

## Architecture for 20-30 users:

```
                    ┌─────────────┐
                    │   Nginx     │
                    │ (Reverse    │
                    │  Proxy)     │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │ Node 1  │      │ Node 2  │      │ Node 3  │
    │ (PM2)   │      │ (PM2)   │      │ (PM2)   │
    └────┬────┘      └────┬────┘      └────┬────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
                    ┌──────▼──────┐
                    │  PostgreSQL │
                    │   (Pool 20) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Redis    │
                    │  (BullMQ)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  AI Worker  │
                    │  (Gemini)   │
                    └─────────────┘
```

## Quick Fix for Current Setup:

1. Install Redis: `sudo apt install redis-server`
2. Start Redis: `redis-server --daemonize yes`
3. Update .env with Redis config
4. The queue will work automatically