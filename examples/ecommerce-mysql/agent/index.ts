import { Agent, run } from '@openai/agents';
import { tool } from '@openai/agents';
import { anthropic } from '@ai-sdk/anthropic';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'mysql://mimic:mimic@localhost:3306/mimic_ecommerce';

// ---------------------------------------------------------------------------
// MySQL Connection Pool
// ---------------------------------------------------------------------------

function createMySQLPool(): Pool {
  const url = new URL(DATABASE_URL);
  return createPool({
    host: url.hostname,
    port: parseInt(url.port || '3306', 10),
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  });
}

const pool = createMySQLPool();

// ---------------------------------------------------------------------------
// Claude model via Vercel AI SDK adapter
// ---------------------------------------------------------------------------

const model = aisdk(anthropic(MODEL));

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const searchProducts = tool({
  name: 'search_products',
  description:
    'Search for products by name, category, or price range. Returns matching products with stock and pricing info.',
  parameters: z.object({
    query: z
      .string()
      .optional()
      .describe('Search term to match against product name or description'),
    category: z
      .string()
      .optional()
      .describe('Category slug to filter by (e.g. "electronics", "fashion")'),
    min_price: z
      .number()
      .optional()
      .describe('Minimum price filter'),
    max_price: z
      .number()
      .optional()
      .describe('Maximum price filter'),
    in_stock_only: z
      .boolean()
      .optional()
      .default(true)
      .describe('Only return products that are in stock'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ query, category, min_price, max_price, in_stock_only, limit }) => {
    const conditions: string[] = ['p.is_active = TRUE'];
    const params: unknown[] = [];

    if (query) {
      conditions.push('(p.name LIKE ? OR p.description LIKE ?)');
      const pattern = `%${query}%`;
      params.push(pattern, pattern);
    }

    if (category) {
      conditions.push('c.slug = ?');
      params.push(category);
    }

    if (min_price !== undefined) {
      conditions.push('p.price >= ?');
      params.push(min_price);
    }

    if (max_price !== undefined) {
      conditions.push('p.price <= ?');
      params.push(max_price);
    }

    if (in_stock_only) {
      conditions.push('p.stock_quantity > 0');
    }

    params.push(Math.min(limit ?? 20, 50));

    const sql = `
      SELECT
        p.id,
        p.name,
        p.slug,
        p.description,
        p.price,
        p.sku,
        p.stock_quantity,
        c.name AS category_name,
        c.slug AS category_slug
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.name ASC
      LIMIT ?
    `;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
    return JSON.stringify({ products: rows, count: rows.length });
  },
});

const getOrders = tool({
  name: 'get_orders',
  description:
    'Get orders for a customer, optionally filtered by status or date range.',
  parameters: z.object({
    customer_id: z
      .number()
      .describe('Customer ID to look up orders for'),
    status: z
      .enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'])
      .optional()
      .describe('Filter by order status'),
    since: z
      .string()
      .optional()
      .describe('Only return orders created on or after this date (YYYY-MM-DD)'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of orders to return'),
  }),
  execute: async ({ customer_id, status, since, limit }) => {
    const conditions: string[] = ['o.customer_id = ?'];
    const params: unknown[] = [customer_id];

    if (status) {
      conditions.push('o.status = ?');
      params.push(status);
    }

    if (since) {
      conditions.push('o.created_at >= ?');
      params.push(since);
    }

    params.push(Math.min(limit ?? 20, 50));

    const sql = `
      SELECT
        o.id,
        o.status,
        o.subtotal,
        o.tax,
        o.total,
        o.shipping_address,
        o.created_at,
        o.updated_at,
        COUNT(oi.id) AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT ?
    `;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
    return JSON.stringify({ orders: rows, count: rows.length });
  },
});

const getOrderDetails = tool({
  name: 'get_order_details',
  description:
    'Get the full details of a specific order, including all line items with product info.',
  parameters: z.object({
    order_id: z.number().describe('The order ID to look up'),
  }),
  execute: async ({ order_id }) => {
    const orderSql = `
      SELECT
        o.id,
        o.customer_id,
        o.status,
        o.subtotal,
        o.tax,
        o.total,
        o.shipping_address,
        o.created_at,
        o.updated_at,
        c.first_name,
        c.last_name,
        c.email
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ?
    `;

    const itemsSql = `
      SELECT
        oi.id AS item_id,
        oi.quantity,
        oi.unit_price,
        oi.total,
        p.name AS product_name,
        p.sku,
        cat.name AS category_name
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN categories cat ON cat.id = p.category_id
      WHERE oi.order_id = ?
      ORDER BY oi.id ASC
    `;

    const [[orderRows], [itemRows]] = await Promise.all([
      pool.execute<RowDataPacket[]>(orderSql, [order_id]),
      pool.execute<RowDataPacket[]>(itemsSql, [order_id]),
    ]);

    if (orderRows.length === 0) {
      return JSON.stringify({ error: `Order #${order_id} not found` });
    }

    return JSON.stringify({ order: orderRows[0], items: itemRows });
  },
});

const getCustomerInfo = tool({
  name: 'get_customer_info',
  description:
    'Look up customer information by ID or email address. Returns profile, order count, and total spend.',
  parameters: z.object({
    customer_id: z
      .number()
      .optional()
      .describe('Customer ID to look up'),
    email: z
      .string()
      .optional()
      .describe('Customer email to look up'),
  }),
  execute: async ({ customer_id, email }) => {
    if (!customer_id && !email) {
      return JSON.stringify({ error: 'Provide either customer_id or email' });
    }

    const condition = customer_id ? 'c.id = ?' : 'c.email = ?';
    const param = customer_id ?? email;

    const sql = `
      SELECT
        c.id,
        c.email,
        c.first_name,
        c.last_name,
        c.phone,
        c.address,
        c.city,
        c.state,
        c.zip_code,
        c.created_at,
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(o.total), 0) AS total_spend,
        MAX(o.created_at) AS last_order_date
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
      WHERE ${condition}
      GROUP BY c.id
    `;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, [param]);

    if (rows.length === 0) {
      return JSON.stringify({ error: 'Customer not found' });
    }

    return JSON.stringify({ customer: rows[0] });
  },
});

const getReviews = tool({
  name: 'get_reviews',
  description:
    'Get product reviews, optionally filtered by product, customer, or minimum rating.',
  parameters: z.object({
    product_id: z
      .number()
      .optional()
      .describe('Filter reviews for a specific product'),
    customer_id: z
      .number()
      .optional()
      .describe('Filter reviews by a specific customer'),
    min_rating: z
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe('Minimum star rating (1-5)'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of reviews to return'),
  }),
  execute: async ({ product_id, customer_id, min_rating, limit }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (product_id !== undefined) {
      conditions.push('r.product_id = ?');
      params.push(product_id);
    }

    if (customer_id !== undefined) {
      conditions.push('r.customer_id = ?');
      params.push(customer_id);
    }

    if (min_rating !== undefined) {
      conditions.push('r.rating >= ?');
      params.push(min_rating);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.min(limit ?? 20, 50));

    const sql = `
      SELECT
        r.id,
        r.rating,
        r.title,
        r.body,
        r.created_at,
        p.name AS product_name,
        p.slug AS product_slug,
        c.first_name AS reviewer_first_name,
        c.last_name AS reviewer_last_name
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      JOIN customers c ON c.id = r.customer_id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ?
    `;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);

    // Compute average rating when filtering by product
    let avgRating: number | null = null;
    if (product_id !== undefined) {
      const [avgRows] = await pool.execute<RowDataPacket[]>(
        'SELECT AVG(rating) AS avg_rating, COUNT(*) AS review_count FROM reviews WHERE product_id = ?',
        [product_id],
      );
      if (avgRows.length > 0) {
        avgRating = parseFloat(Number(avgRows[0].avg_rating).toFixed(2));
      }
    }

    return JSON.stringify({
      reviews: rows,
      count: rows.length,
      ...(avgRating !== null ? { average_rating: avgRating } : {}),
    });
  },
});

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a helpful e-commerce assistant for an online store.',
  'Use the available tools to answer questions about products, orders, customers, and reviews.',
  'Be precise with numbers, prices, and dates.',
  'When asked about products, always query real data from the database -- never guess.',
  'Format currency amounts with $ and two decimal places.',
  'If a question is ambiguous, ask for clarification before running queries.',
].join(' ');

const agent = new Agent({
  name: 'E-Commerce Assistant',
  instructions: SYSTEM_PROMPT,
  model,
  tools: [searchProducts, getOrders, getOrderDetails, getCustomerInfo, getReviews],
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
// HTTP Server
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
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
      await pool.execute('SELECT 1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', database: 'connected' }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', database: 'disconnected' }));
    }
    return;
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/chat') {
    try {
      const body = await readBody(req);
      const { message } = JSON.parse(body);

      if (!message || typeof message !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "message" field (string)' }));
        return;
      }

      const result = await handleChat(message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('Chat error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
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
// Startup & Shutdown
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  // Verify database connectivity before starting
  try {
    await pool.execute('SELECT 1');
    console.log('MySQL connection verified.');
  } catch (err) {
    console.error('Failed to connect to MySQL:', err);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`E-commerce agent running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  POST /chat   - Send { "message": "..." }`);
    console.log(`  GET  /health - Health check`);
  });
}

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  await pool.end();
  console.log('MySQL pool closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
