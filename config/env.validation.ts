import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.string().default('3001'),
  ALCHEMY_API_KEY: z.string(),
  QUICKNODE_API_KEY: z.string(),
  SUPABASE_URL: z.string(),
  SUPABASE_API_KEY: z.string(),
});

export type EnvConfig = z.infer<typeof envSchema>;
