# E-Commerce MySQL Example

A complete working example of Mimic with a MySQL-backed e-commerce storefront.

## Prerequisites

- Node.js >= 22
- Docker (for MySQL)
- Anthropic API key

## Quick Start

```bash
# 1. Start MySQL
docker compose up -d

# 2. Set environment
export DATABASE_URL="mysql://mimic:mimic@localhost:3306/mimic_ecommerce"
export ANTHROPIC_API_KEY="your-key-here"

# 3. Generate and seed data
mimic run
mimic seed --verbose

# 4. Inspect what was generated
mimic inspect schema
mimic inspect data

# 5. Start the agent
cd agent && npm install && npm start

# 6. Chat with the agent
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me the top electronics under $100"}'

# 7. Health check
curl http://localhost:3001/health

# 8. Cleanup
mimic clean --yes
docker compose down
```

## What You Get

For the **power-shopper** persona (34yo marketing exec, frequent buyer):

```
customers:    1 row
categories:   6-8 rows   (Electronics, Fashion, Home, Books, ...)
products:     20-30 rows (spread across categories)
orders:       ~25-40     (6 months of frequent purchasing)
order_items:  ~60-100    (1-4 items per order)
reviews:      ~15-25     (reviews on purchased products)
```

For the **casual-browser** persona (22yo grad student, budget-conscious):

```
customers:    1 row
orders:       ~8-12      (occasional purchases over 6 months)
order_items:  ~10-15     (mostly single-item orders)
reviews:      ~3-5       (occasional reviews)
```

## Schema

```
+------------+       +------------+       +------------+
| customers  |       | categories |<------+| categories |
+------------+       +------------+ self  | (parent_id)|
| id (PK)    |       | id (PK)    | ref   +------------+
| email (UQ) |       | name       |
| first_name |       | slug (UQ)  |       +------------+
| last_name  |       | description|       | products   |
| phone      |       | parent_id  |       +------------+
| address    |       +-----+------+       | id (PK)    |
| city       |             |              | category_id|---> categories
| state      |             +--------------+ name       |
| zip_code   |                            | slug (UQ)  |
| created_at |       +------------+       | price      |
| updated_at |       | orders     |       | sku (UQ)   |
+------+-----+       +------------+       | stock_qty  |
       |              | id (PK)    |       | is_active  |
       +--------------+ customer_id|       | created_at |
       |              | status     |       +-----+------+
       |              | subtotal   |             |
       |              | tax        |       +-----+------+
       |              | total      |       | reviews    |
       |              | ship_addr  |       +------------+
       |              | created_at |       | id (PK)    |
       |              | updated_at |       | product_id |---> products
       |              +-----+------+       | customer_id|---> customers
       |                    |              | rating 1-5 |
       |              +-----+------+       | title      |
       |              | order_items|       | body       |
       |              +------------+       | created_at |
       |              | id (PK)    |       +------------+
       |              | order_id   |---> orders
       |              | product_id |---> products
       +--------------+ quantity   |
                      | unit_price |
                      | total      |
                      +------------+

status ENUM: pending | confirmed | shipped | delivered | cancelled
```

## Agent Architecture

The agent uses the [Vercel AI SDK](https://sdk.vercel.ai/) with:

- **Model**: Claude Haiku via `@ai-sdk/anthropic`
- **Database**: Direct MySQL connection via `mysql2` connection pool
- **Tools**: `search_products`, `get_orders`, `get_order_details`, `get_customer_info`, `get_reviews`
- **Endpoint**: `POST /chat` with `{ "message": "..." }` returns `{ "text": "...", "toolCalls": [...] }`

Each tool runs parameterized SQL queries (no string interpolation) to prevent SQL injection.

## Agent Tools

| Tool | Description |
|---|---|
| `search_products` | Search by name, category, price range; filter in-stock |
| `get_orders` | List orders by customer with status and date filters |
| `get_order_details` | Full order with line items and product info |
| `get_customer_info` | Customer profile with order count and total spend |
| `get_reviews` | Product reviews with optional rating filter |

## Example Queries

```bash
# Product search
curl -s -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What electronics do you have under $50?"}' | jq .

# Order history
curl -s -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me all orders for customer 1"}' | jq .

# Review summary
curl -s -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the highest rated products?"}' | jq .
```

## Cleanup

```bash
mimic clean --yes
docker compose down -v   # -v removes the mysqldata volume
```
