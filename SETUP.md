# Setup Guide

## Development Environment

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env.local
```

3. Initialize the database (SQLite):
```bash
npm run db:push:dev
```

4. Start the development server:
```bash
npm run dev
```

## Production Environment (Vercel)

### Initial Setup

1. Set `DATABASE_URL` in Vercel project settings to your PostgreSQL connection string.

2. Set `NODE_ENV=production` in Vercel environment variables.

3. Deploy the application:
```bash
git push origin main
```

The build process will:
- Run `npm install` (which triggers `postinstall` to generate Prisma client)
- Run `npm run build` (Next.js build without database schema push)

### Database Schema Initialization

For the **first deployment only**, you need to initialize the database schema **before deploying** to Vercel:

```bash
npm run db:push
```

or with environment variable:

```bash
DATABASE_URL="postgresql://..." npm run db:push
```

**Important:** This must be run before the first Vercel deployment to ensure the database schema exists. After the schema is initialized, Vercel builds will work automatically without running `prisma db push` again.

### Subsequent Deployments

Once the database schema is initialized, normal deployments will work without additional steps:
- The build process skips `prisma db push` in production
- Prisma client is generated from the existing schema
- Next.js builds successfully

## Environment Variables

### Development (.env.local)
```
ANTHROPIC_API_KEY=your-key
DATABASE_URL=file:./dev.db
```

### Production (Vercel)
```
ANTHROPIC_API_KEY=your-key
DATABASE_URL=postgresql://...
NODE_ENV=production
```

## Troubleshooting

### "Error: P1001 Can't reach database server"
- Verify DATABASE_URL is set correctly in Vercel environment
- Check VPC/firewall settings for database access
- Ensure PostgreSQL server is running and accessible

### "Prisma client generation failed"
- Check Node.js version (should be 18+)
- Verify dependencies installed correctly: `npm install`
- Try regenerating: `npm run db:generate`

### Schema mismatch errors
- Ensure local schema matches production schema
- Use `prisma db pull` to sync schema from database
- Review pending migrations with `prisma migrate status`
