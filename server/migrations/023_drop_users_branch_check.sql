-- Branch is a free-text field backed by the branches catalog.
-- An old CHECK listing only Head Office / Unit / Branch / Amir Chamber
-- made admin Save fail for any newer office.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_branch_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_branch_chk;

COMMIT;
