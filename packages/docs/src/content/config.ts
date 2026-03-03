import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    eyebrow: z.string().optional(),
    description: z.string(),
    order: z.number(),
    slug: z.string(),
    prev: z.object({ slug: z.string(), title: z.string() }).optional(),
    next: z.object({ slug: z.string(), title: z.string() }).optional(),
  }),
});

export const collections = { docs };
