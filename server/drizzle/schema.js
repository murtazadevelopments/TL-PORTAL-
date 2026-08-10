const {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
} = require('drizzle-orm/pg-core');

/**
 * Employee portal users table.
 * Column names stay snake_case so API responses match the frontend.
 */
const users = pgTable('users', {
  id: serial('id').primaryKey(),
  employee_id: varchar('employee_id', { length: 64 }).notNull().unique(),
  full_name: text('full_name').notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: text('password').notNull(),
  role: varchar('role', { length: 64 }).notNull().default('employee'),
  department: text('department'),
  phone: varchar('phone', { length: 256 }),
  address: text('address'),
  avatar_url: text('avatar_url'),
  date_joined: timestamp('date_joined', { withTimezone: true }).defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

module.exports = { users };
