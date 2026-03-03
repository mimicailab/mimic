-- tasks-sqlite schema
-- SQLite DDL for a project and task management application

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT CHECK(status IN ('active', 'completed', 'archived')) DEFAULT 'active',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id),
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT CHECK(status IN ('todo', 'in_progress', 'review', 'done', 'blocked')) DEFAULT 'todo',
  priority        TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  assignee        TEXT,
  due_date        TEXT,
  estimated_hours REAL,
  actual_hours    REAL,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS labels (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6B7280'
);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id  INTEGER REFERENCES tasks(id),
  label_id INTEGER REFERENCES labels(id),
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
