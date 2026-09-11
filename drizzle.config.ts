import type { Config } from 'drizzle-kit'
import 'dotenv/config'

// Schema lives in db/*.sql; introspect generates lib/schema.ts from the live database.
export default {
  dialect: 'postgresql',
  out: './lib',
  schema: './lib/schema.ts',
  dbCredentials: { url: process.env.DATABASE_URL_OWNER! },
  introspect: { casing: 'preserve' },
} satisfies Config
