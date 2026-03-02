-- Fintech Multi-DB Example — PostgreSQL Schema
-- Structured financial data: users, accounts, transactions

CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    phone       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE accounts (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'investment', 'credit')),
    institution TEXT NOT NULL,
    balance     DECIMAL(14, 2) NOT NULL,
    currency    TEXT DEFAULT 'USD',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
    id          SERIAL PRIMARY KEY,
    account_id  INT NOT NULL REFERENCES accounts(id),
    date        DATE NOT NULL,
    amount      DECIMAL(14, 2) NOT NULL,
    category    TEXT NOT NULL,
    merchant    TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'posted' CHECK (status IN ('pending', 'posted', 'cancelled')),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(category);
