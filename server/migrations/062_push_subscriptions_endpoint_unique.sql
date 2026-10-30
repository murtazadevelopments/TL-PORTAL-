-- Ensure push_subscriptions.endpoint stays unique (shared-device upsert reassigns user_id).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_subscriptions_endpoint_unique'
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint);
  END IF;
END $$;
