-- MIRA Platform — initial schema
-- Organizations are the top-level tenant boundary.
-- All data is scoped to an organization; no cross-org queries are possible via RLS.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Organizations ─────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX users_org_id_idx ON users(org_id);

-- ─── Devices ───────────────────────────────────────────────────────────────────
CREATE TABLE devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('sensor', 'camera')),
  api_key     TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status      TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX devices_org_id_idx ON devices(org_id);
CREATE INDEX devices_api_key_idx ON devices(api_key);

-- ─── Events ────────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX events_org_id_idx       ON events(org_id);
CREATE INDEX events_device_id_idx    ON events(device_id);
CREATE INDEX events_created_at_idx   ON events(created_at DESC);
CREATE INDEX events_severity_idx     ON events(severity);

-- ─── Row-Level Security ────────────────────────────────────────────────────────
-- RLS ensures that even if application-level filtering is bypassed,
-- the database will not return rows belonging to another organization.

ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE events   ENABLE ROW LEVEL SECURITY;

-- Application connects as role 'mira_app'. Policies filter by the session variable
-- app.current_org_id, which the CRUD handler sets at the start of every transaction.
CREATE ROLE mira_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations TO mira_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users        TO mira_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON devices      TO mira_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON events       TO mira_app;

CREATE POLICY users_org_isolation   ON users   FOR ALL TO mira_app
  USING (org_id = current_setting('app.current_org_id')::UUID);

CREATE POLICY devices_org_isolation ON devices FOR ALL TO mira_app
  USING (org_id = current_setting('app.current_org_id')::UUID);

CREATE POLICY events_org_isolation  ON events  FOR ALL TO mira_app
  USING (org_id = current_setting('app.current_org_id')::UUID);

-- ─── Seed: demo organization ───────────────────────────────────────────────────
INSERT INTO organizations (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'MIRA Demo Org');
