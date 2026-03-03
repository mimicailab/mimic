import { Agent, run } from '@openai/agents';
import { tool } from '@openai/agents';
import { anthropic } from '@ai-sdk/anthropic';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3003', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DATABASE = process.env.MONGO_DATABASE ?? 'mimic_blog';

// ---------------------------------------------------------------------------
// MongoDB connection
// ---------------------------------------------------------------------------

const client = new MongoClient(MONGO_URL);
const db = client.db(DATABASE);

// Collection references
const posts = db.collection('posts');
const comments = db.collection('comments');
const users = db.collection('users');
const bookmarks = db.collection('bookmarks');

// ---------------------------------------------------------------------------
// Helper: safe ObjectId parsing
// ---------------------------------------------------------------------------

function toObjectId(id: string): ObjectId | null {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude model via Vercel AI SDK adapter
// ---------------------------------------------------------------------------

const model = aisdk(anthropic(MODEL));

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const searchPosts = tool({
  name: 'search_posts',
  description:
    'Search blog posts by text query, tags, date range, or any combination. ' +
    'Returns matching posts with title, slug, excerpt, tags, author, and publish date.',
  parameters: z.object({
    query: z
      .string()
      .optional()
      .describe('Full-text search query to match against title and body'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Filter by one or more tags (posts matching ANY tag are returned)'),
    author_id: z
      .string()
      .optional()
      .describe('Filter by author ObjectId'),
    from_date: z
      .string()
      .optional()
      .describe('Start of date range (ISO 8601, inclusive)'),
    to_date: z
      .string()
      .optional()
      .describe('End of date range (ISO 8601, inclusive)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ query, tags, author_id, from_date, to_date, limit }) => {
    const filter: Record<string, unknown> = {};

    if (query) {
      filter.$text = { $search: query };
    }
    if (tags && tags.length > 0) {
      filter.tags = { $in: tags };
    }
    if (author_id) {
      const oid = toObjectId(author_id);
      if (oid) filter.author_id = oid;
    }

    const dateFilter: Record<string, Date> = {};
    if (from_date) dateFilter.$gte = new Date(from_date);
    if (to_date) dateFilter.$lte = new Date(to_date);
    if (Object.keys(dateFilter).length > 0) {
      filter.published_at = dateFilter;
    }

    const projection = {
      title: 1,
      slug: 1,
      excerpt: 1,
      tags: 1,
      author_id: 1,
      published_at: 1,
      view_count: 1,
      like_count: 1,
    };

    const sort: Record<string, 1 | -1> = query
      ? { score: { $meta: 'textScore' } as unknown as 1 }
      : { published_at: -1 };

    const results = await posts
      .find(filter, { projection })
      .sort(sort)
      .limit(limit)
      .toArray();

    return JSON.stringify({ count: results.length, posts: results });
  },
});

const getPost = tool({
  name: 'get_post',
  description:
    'Retrieve a single blog post by its ID, including the full body content.',
  parameters: z.object({
    post_id: z.string().describe('The ObjectId of the post'),
  }),
  execute: async ({ post_id }) => {
    const oid = toObjectId(post_id);
    if (!oid) return JSON.stringify({ error: 'Invalid post ID format' });

    const post = await posts.findOne({ _id: oid });
    if (!post) return JSON.stringify({ error: 'Post not found' });

    return JSON.stringify(post);
  },
});

const getComments = tool({
  name: 'get_comments',
  description:
    'Get comments for a specific post, sorted by most recent first. ' +
    'Supports pagination via skip and limit.',
  parameters: z.object({
    post_id: z.string().describe('The ObjectId of the post'),
    skip: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Number of comments to skip (for pagination)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of comments to return'),
  }),
  execute: async ({ post_id, skip, limit }) => {
    const oid = toObjectId(post_id);
    if (!oid) return JSON.stringify({ error: 'Invalid post ID format' });

    const pipeline = [
      { $match: { post_id: oid } },
      { $sort: { created_at: -1 as const } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'author_id',
          foreignField: '_id',
          as: 'author',
          pipeline: [{ $project: { username: 1, display_name: 1, avatar_url: 1 } }],
        },
      },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
    ];

    const results = await comments.aggregate(pipeline).toArray();
    const total = await comments.countDocuments({ post_id: oid });

    return JSON.stringify({ total, count: results.length, skip, comments: results });
  },
});

const getAuthorPosts = tool({
  name: 'get_author_posts',
  description:
    'Get all posts by a specific author, sorted by publish date descending. ' +
    'Also returns the author profile information.',
  parameters: z.object({
    author_id: z
      .string()
      .optional()
      .describe('The ObjectId of the author'),
    username: z
      .string()
      .optional()
      .describe('The username of the author (alternative to author_id)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Maximum number of posts to return'),
  }),
  execute: async ({ author_id, username, limit }) => {
    let authorDoc;

    if (author_id) {
      const oid = toObjectId(author_id);
      if (!oid) return JSON.stringify({ error: 'Invalid author ID format' });
      authorDoc = await users.findOne({ _id: oid });
    } else if (username) {
      authorDoc = await users.findOne({ username });
    } else {
      return JSON.stringify({ error: 'Provide either author_id or username' });
    }

    if (!authorDoc) return JSON.stringify({ error: 'Author not found' });

    const authorPosts = await posts
      .find(
        { author_id: authorDoc._id },
        {
          projection: {
            title: 1,
            slug: 1,
            excerpt: 1,
            tags: 1,
            published_at: 1,
            view_count: 1,
            like_count: 1,
          },
        },
      )
      .sort({ published_at: -1 })
      .limit(limit)
      .toArray();

    return JSON.stringify({
      author: {
        _id: authorDoc._id,
        username: authorDoc.username,
        display_name: authorDoc.display_name,
        bio: authorDoc.bio,
      },
      count: authorPosts.length,
      posts: authorPosts,
    });
  },
});

const getPopularPosts = tool({
  name: 'get_popular_posts',
  description:
    'Get the most popular blog posts ranked by a weighted engagement score ' +
    '(views + 5x likes + 10x comments). Supports filtering by time period and tags.',
  parameters: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe('Look back this many days from today'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Filter by one or more tags'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum number of posts to return'),
  }),
  execute: async ({ days, tags, limit }) => {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const matchStage: Record<string, unknown> = {
      published_at: { $gte: since },
    };
    if (tags && tags.length > 0) {
      matchStage.tags = { $in: tags };
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'post_id',
          as: '_comments',
        },
      },
      {
        $addFields: {
          comment_count: { $size: '$_comments' },
          engagement_score: {
            $add: [
              { $ifNull: ['$view_count', 0] },
              { $multiply: [{ $ifNull: ['$like_count', 0] }, 5] },
              { $multiply: [{ $size: '$_comments' }, 10] },
            ],
          },
        },
      },
      {
        $project: {
          _comments: 0,
          body: 0,
        },
      },
      { $sort: { engagement_score: -1 as const } },
      { $limit: limit },
    ];

    const results = await posts.aggregate(pipeline).toArray();
    return JSON.stringify({ count: results.length, days, posts: results });
  },
});

const searchByTag = tool({
  name: 'search_by_tag',
  description:
    'Get all posts matching a specific tag or list of tags. Returns posts ' +
    'sorted by publish date and includes a breakdown of tag frequency.',
  parameters: z.object({
    tags: z
      .array(z.string())
      .min(1)
      .describe('One or more tags to search for'),
    match_all: z
      .boolean()
      .default(false)
      .describe('If true, posts must have ALL specified tags (AND). Default is ANY (OR).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Maximum number of posts to return'),
  }),
  execute: async ({ tags, match_all, limit }) => {
    const tagFilter = match_all ? { $all: tags } : { $in: tags };

    const [taggedPosts, tagStats] = await Promise.all([
      posts
        .find(
          { tags: tagFilter },
          {
            projection: {
              title: 1,
              slug: 1,
              excerpt: 1,
              tags: 1,
              author_id: 1,
              published_at: 1,
              view_count: 1,
              like_count: 1,
            },
          },
        )
        .sort({ published_at: -1 })
        .limit(limit)
        .toArray(),

      posts
        .aggregate([
          { $match: { tags: tagFilter } },
          { $unwind: '$tags' },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { count: -1 as const } },
        ])
        .toArray(),
    ]);

    return JSON.stringify({
      count: taggedPosts.length,
      tag_frequency: tagStats.map((t) => ({ tag: t._id, count: t.count })),
      posts: taggedPosts,
    });
  },
});

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a knowledgeable blog content assistant with access to a MongoDB-backed technical blog.',
  'Use the available tools to answer questions about posts, authors, comments, and content trends.',
  'Always base your answers on real data from the database -- never guess or fabricate.',
  'When listing posts, include the title, author, date, and tags.',
  'Format dates in a human-readable way (e.g., "March 15, 2025").',
  'If a query returns no results, say so clearly and suggest alternative searches.',
].join(' ');

const agent = new Agent({
  name: 'Blog Content Assistant',
  instructions: SYSTEM_PROMPT,
  model,
  tools: [searchPosts, getPost, getComments, getAuthorPosts, getPopularPosts, searchByTag],
});

// ---------------------------------------------------------------------------
// Chat handler
// ---------------------------------------------------------------------------

async function handleChat(message: string): Promise<{
  text: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}> {
  const result = await run(agent, message);

  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  for (const item of result.newItems) {
    if (item.type === 'tool_call_item') {
      toolCalls.push({
        name: item.rawItem.name ?? '',
        arguments:
          typeof item.rawItem.arguments === 'string'
            ? JSON.parse(item.rawItem.arguments)
            : (item.rawItem.arguments as Record<string, unknown>) ?? {},
      });
    }
  }

  return {
    text: result.finalOutput ?? '',
    toolCalls,
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    try {
      await db.command({ ping: 1 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', database: DATABASE }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'unhealthy',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/chat') {
    const body = await readBody(req);

    try {
      const parsed = JSON.parse(body);
      const message = parsed.message;

      if (!message || typeof message !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "message" field (string)' }));
        return;
      }

      const result = await handleChat(message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const status = err instanceof SyntaxError ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ---------------------------------------------------------------------------
// Startup & shutdown
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  console.log(`Connecting to MongoDB at ${MONGO_URL}...`);
  await client.connect();

  // Verify connection
  await db.command({ ping: 1 });
  console.log(`Connected to database "${DATABASE}".`);

  // List collections for visibility
  const collections = await db.listCollections().toArray();
  console.log(
    `Collections: ${collections.map((c) => c.name).join(', ') || '(none)'}`,
  );

  server.listen(PORT, () => {
    console.log(`Blog agent running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log('POST /chat  { "message": "..." }');
    console.log('GET  /health');
  });
}

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  await client.close();
  console.log('MongoDB connection closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  client.close().finally(() => process.exit(1));
});
