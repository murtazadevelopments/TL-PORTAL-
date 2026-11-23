-- Convert existing CNIC values to XXXXX-XXXXXXX-X without changing digits.
UPDATE users u
SET cnic_number =
  substr(s.digits, 1, 5) || '-' ||
  substr(s.digits, 6, 7) || '-' ||
  substr(s.digits, 13, 1)
FROM (
  SELECT
    id,
    regexp_replace(COALESCE(cnic_number, ''), '[^0-9]', '', 'g') AS digits
  FROM users
  WHERE cnic_number IS NOT NULL
    AND trim(cnic_number) <> ''
) s
WHERE u.id = s.id
  AND length(s.digits) = 13
  AND u.cnic_number IS DISTINCT FROM (
    substr(s.digits, 1, 5) || '-' ||
    substr(s.digits, 6, 7) || '-' ||
    substr(s.digits, 13, 1)
  );
