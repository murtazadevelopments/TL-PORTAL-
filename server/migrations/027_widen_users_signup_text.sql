-- Signup was failing: value too long for character varying(50).
-- Bcrypt password hashes are 60 chars; names, addresses, and bank titles can exceed 50.

ALTER TABLE users ALTER COLUMN password TYPE TEXT;
ALTER TABLE users ALTER COLUMN name TYPE TEXT;
ALTER TABLE users ALTER COLUMN email TYPE TEXT;
ALTER TABLE users ALTER COLUMN contact_number TYPE TEXT;
ALTER TABLE users ALTER COLUMN address TYPE TEXT;
ALTER TABLE users ALTER COLUMN education TYPE TEXT;
ALTER TABLE users ALTER COLUMN bank_name TYPE TEXT;
ALTER TABLE users ALTER COLUMN account_title TYPE TEXT;
ALTER TABLE users ALTER COLUMN account_number TYPE TEXT;
ALTER TABLE users ALTER COLUMN iban TYPE TEXT;
ALTER TABLE users ALTER COLUMN cnic_number TYPE TEXT;
ALTER TABLE users ALTER COLUMN profile_picture_url TYPE TEXT;
ALTER TABLE users ALTER COLUMN cnic_front_url TYPE TEXT;
ALTER TABLE users ALTER COLUMN cnic_back_url TYPE TEXT;
ALTER TABLE users ALTER COLUMN cv_url TYPE TEXT;
