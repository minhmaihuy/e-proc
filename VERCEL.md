# E-Audit Platform - Vercel + Supabase Deployment Guide

## Simple Architecture for Vercel (No Redis Needed)

```
┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│  Supabase   │
│  (Server)   │     │ (PostgreSQL)│
│             │     └─────────────┘
│  - API      │
│  - Queue    │     ┌─────────────┐
│  (In-DB)    │────▶│   Gemini    │
└─────────────┘     │  (AI API)   │
                    └─────────────┘
```

## Changes for Vercel Deployment:

1. **Database:** Supabase PostgreSQL (free tier)
2. **Queue:** Use PostgreSQL table as queue + Vercel Cron job
3. **No Redis needed**