import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const kosongJadiTiada = (v: unknown) => (v === '' || v === null ? undefined : v);

const artikel = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/artikel' }),
  schema: z.object({
    title: z.string(),
    date: z.preprocess(kosongJadiTiada, z.coerce.date().optional()),
    category: z.string().default('Program'),
    author: z.preprocess(kosongJadiTiada, z.string().optional()),
    authorRole: z.preprocess(kosongJadiTiada, z.string().optional()),
    cover: z.preprocess(kosongJadiTiada, z.string().optional()),
    coverAlt: z.preprocess(kosongJadiTiada, z.string().optional()),
    ringkasan: z.array(z.string()).default([]),
    video: z.preprocess(kosongJadiTiada, z.string().optional()),
    galeri: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { artikel };
