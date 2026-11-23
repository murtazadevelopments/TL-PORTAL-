-- Convert existing 11-digit contact numbers to 03XZ-YYYYYYY (XXXX-XXXXXXX) without changing digits.
UPDATE users u
SET contact_number = substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
FROM (
  SELECT
    id,
    regexp_replace(COALESCE(contact_number, ''), '[^0-9]', '', 'g') AS digits
  FROM users
  WHERE contact_number IS NOT NULL
    AND trim(contact_number) <> ''
) s
WHERE u.id = s.id
  AND length(s.digits) = 11
  AND u.contact_number IS DISTINCT FROM (
    substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
  );

UPDATE users u
SET emergency_contact_number = substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
FROM (
  SELECT
    id,
    regexp_replace(COALESCE(emergency_contact_number, ''), '[^0-9]', '', 'g') AS digits
  FROM users
  WHERE emergency_contact_number IS NOT NULL
    AND trim(emergency_contact_number) <> ''
) s
WHERE u.id = s.id
  AND length(s.digits) = 11
  AND u.emergency_contact_number IS DISTINCT FROM (
    substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
  );
