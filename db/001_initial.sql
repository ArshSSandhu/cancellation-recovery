CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE identities (
  id text PRIMARY KEY, name text NOT NULL, role text NOT NULL CHECK (role IN ('staff','patient'))
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, identity_id text NOT NULL REFERENCES identities,
  expires_at timestamptz NOT NULL
);
CREATE TABLE clinicians (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE slots (
  id text PRIMARY KEY, clinician_id text NOT NULL REFERENCES clinicians,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  visit_type text NOT NULL CHECK (visit_type = 'follow-up'),
  modality text NOT NULL CHECK (modality IN ('video','in-person')), location text NOT NULL,
  CHECK (ends_at > starts_at), UNIQUE(id, starts_at, ends_at),
  EXCLUDE USING gist (clinician_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id text NOT NULL REFERENCES identities,
  slot_id text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('booked','cancelled','replaced')),
  version integer NOT NULL DEFAULT 1,
  replacement_id uuid REFERENCES appointments DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (slot_id, starts_at, ends_at) REFERENCES slots(id, starts_at, ends_at),
  CHECK ((status = 'replaced') = (replacement_id IS NOT NULL)),
  EXCLUDE USING gist (patient_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'booked')
);
CREATE UNIQUE INDEX one_booking_per_slot ON appointments(slot_id) WHERE status = 'booked';
CREATE TABLE waitlist (
  id text PRIMARY KEY, appointment_id uuid NOT NULL UNIQUE REFERENCES appointments,
  joined_at timestamptz NOT NULL, opted_in boolean NOT NULL DEFAULT true,
  cleared boolean NOT NULL DEFAULT true,
  available_from timestamptz NOT NULL, available_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','removed')),
  CHECK (available_until > available_from)
);
CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id text NOT NULL REFERENCES slots,
  waitlist_id text NOT NULL REFERENCES waitlist, source_appointment_id uuid NOT NULL REFERENCES appointments,
  source_version integer NOT NULL, patient_id text NOT NULL REFERENCES identities,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  selection_reason text, policy_version text NOT NULL DEFAULT 'v1',
  result_appointment_id uuid REFERENCES appointments,
  CHECK (expires_at > created_at),
  CHECK ((status = 'accepted') = (result_appointment_id IS NOT NULL))
);
CREATE UNIQUE INDEX exclusive_slot_offer ON offers(slot_id) WHERE status = 'pending';
CREATE UNIQUE INDEX exclusive_source_offer ON offers(source_appointment_id) WHERE status = 'pending';
CREATE TABLE audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(), actor_id text REFERENCES identities,
  action text NOT NULL, entity_id text NOT NULL, request_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE FUNCTION protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit history is append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION protect_audit();
