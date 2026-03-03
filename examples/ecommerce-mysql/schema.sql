-- ============================================================================
-- Mimic E-Commerce MySQL Schema
-- ============================================================================
-- This file is automatically loaded by Docker via the initdb.d mount.
-- It creates all tables needed for the e-commerce storefront example.
-- ============================================================================

USE mimic_ecommerce;

-- --------------------------------------------------------------------------
-- Customers
-- --------------------------------------------------------------------------
CREATE TABLE customers (
    id          INT          NOT NULL AUTO_INCREMENT,
    email       VARCHAR(255) NOT NULL,
    first_name  VARCHAR(100) NOT NULL,
    last_name   VARCHAR(100) NOT NULL,
    phone       VARCHAR(20)  NULL,
    address     VARCHAR(255) NULL,
    city        VARCHAR(100) NULL,
    state       VARCHAR(50)  NULL,
    zip_code    VARCHAR(20)  NULL,
    created_at  DATETIME     NOT NULL DEFAULT NOW(),
    updated_at  DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- Categories (self-referencing for sub-categories)
-- --------------------------------------------------------------------------
CREATE TABLE categories (
    id          INT          NOT NULL AUTO_INCREMENT,
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(120) NOT NULL,
    description TEXT         NULL,
    parent_id   INT          NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_categories_slug (slug),
    CONSTRAINT fk_categories_parent
        FOREIGN KEY (parent_id) REFERENCES categories (id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- Products
-- --------------------------------------------------------------------------
CREATE TABLE products (
    id              INT            NOT NULL AUTO_INCREMENT,
    category_id     INT            NOT NULL,
    name            VARCHAR(255)   NOT NULL,
    slug            VARCHAR(280)   NOT NULL,
    description     TEXT           NULL,
    price           DECIMAL(10, 2) NOT NULL,
    sku             VARCHAR(50)    NOT NULL,
    stock_quantity  INT            NOT NULL DEFAULT 0,
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      DATETIME       NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_products_slug (slug),
    UNIQUE KEY uq_products_sku (sku),
    CONSTRAINT fk_products_category
        FOREIGN KEY (category_id) REFERENCES categories (id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- Orders
-- --------------------------------------------------------------------------
CREATE TABLE orders (
    id               INT            NOT NULL AUTO_INCREMENT,
    customer_id      INT            NOT NULL,
    status           ENUM('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')
                                    NOT NULL DEFAULT 'pending',
    subtotal         DECIMAL(10, 2) NOT NULL,
    tax              DECIMAL(10, 2) NOT NULL,
    total            DECIMAL(10, 2) NOT NULL,
    shipping_address TEXT           NULL,
    created_at       DATETIME       NOT NULL DEFAULT NOW(),
    updated_at       DATETIME       NOT NULL DEFAULT NOW() ON UPDATE NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_orders_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_status   ON orders (status);

-- --------------------------------------------------------------------------
-- Order Items
-- --------------------------------------------------------------------------
CREATE TABLE order_items (
    id          INT            NOT NULL AUTO_INCREMENT,
    order_id    INT            NOT NULL,
    product_id  INT            NOT NULL,
    quantity    INT            NOT NULL,
    unit_price  DECIMAL(10, 2) NOT NULL,
    total       DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id) REFERENCES orders (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product
        FOREIGN KEY (product_id) REFERENCES products (id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_order_items_order   ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);

-- --------------------------------------------------------------------------
-- Reviews
-- --------------------------------------------------------------------------
CREATE TABLE reviews (
    id          INT          NOT NULL AUTO_INCREMENT,
    product_id  INT          NOT NULL,
    customer_id INT          NOT NULL,
    rating      TINYINT      NOT NULL,
    title       VARCHAR(255) NULL,
    body        TEXT         NULL,
    created_at  DATETIME     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_reviews_product
        FOREIGN KEY (product_id) REFERENCES products (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reviews_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE CASCADE,
    CONSTRAINT chk_reviews_rating
        CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_reviews_product  ON reviews (product_id);
CREATE INDEX idx_reviews_customer ON reviews (customer_id);
