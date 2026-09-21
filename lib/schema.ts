import { pgTable, index, foreignKey, unique, pgPolicy, check, uuid, bigint, text, boolean, timestamp, bigserial, integer, numeric, time, primaryKey, pgView, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const book_status = pgEnum("book_status", ['present', 'stale'])
export const user_role = pgEnum("user_role", ['direktor', 'sotuv_boshligi', 'hudud_rahbari', 'sotuv_manager'])
export const visit_facing = pgEnum("visit_facing", ['face', 'qisman_face', 'koreshok'])


export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	username: text(),
	password_hash: text(),
	must_change_password: boolean().default(false).notNull(),
	password_set_at: timestamp({ withTimezone: true, mode: 'string' }),
	failed_logins: integer().default(0).notNull(),
	locked_until: timestamp({ withTimezone: true, mode: 'string' }),
	// A note, not an identity, since db/29. You can use { mode: "bigint" } if
	// numbers are exceeding js number limitations
	telegram_id: bigint({ mode: "number" }),
	telegram_username: text(),
	full_name: text().notNull(),
	phone: text(),
	email: text(),
	role: user_role().default('sotuv_manager').notNull(),
	parent_id: uuid(),
	active: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("users_parent_id_idx").using("btree", table.parent_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.parent_id],
			foreignColumns: [table.id],
			name: "users_parent_id_fkey"
		}).onDelete("set null"),
	unique("users_telegram_id_key").on(table.telegram_id),
	// users_username_key is unique on lower(username), which drizzle-kit cannot
	// express; db/01 and db/29 create it.
	unique("users_phone_key").on(table.phone),
	unique("users_email_key").on(table.email),
	pgPolicy("u_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(can_manage_users() AND (id <> current_user_id()))` }),
	pgPolicy("u_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("u_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("u_read", { as: "permissive", for: "select", to: ["public"] }),
	check("no_self_parent", sql`id <> parent_id`),
]);

export const stores = pgTable("stores", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	code: text().notNull(),
	name: text().notNull(),
	region: text().notNull(),
	channel: text(),
	letter_code: text(),
	owner_id: uuid(),
	visit_every_days: integer().default(14).notNull(),
	active: boolean().default(true).notNull(),
}, (table) => [
	index("stores_owner_id_idx").using("btree", table.owner_id.asc().nullsLast().op("uuid_ops")),
	index("stores_region_idx").using("btree", table.region.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "stores_owner_id_fkey"
		}).onDelete("set null"),
	unique("stores_code_key").on(table.code),
	pgPolicy("s_write", { as: "permissive", for: "all", to: ["public"], using: sql`can_manage_users()`, withCheck: sql`can_manage_users()`  }),
	pgPolicy("s_read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const visits = pgTable("visits", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	manager_id: uuid().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	store_id: bigint({ mode: "number" }).notNull(),
	visited_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	width_m: numeric({ precision: 5, scale:  2 }),
	height_m: numeric({ precision: 5, scale:  2 }),
	area_m2: numeric({ precision: 7, scale:  2 }).generatedAlwaysAs(sql`(width_m * height_m)`),
	open_from: time(),
	open_to: time(),
	placement: text().array(),
	facing: visit_facing(),
	shelf_heights: text().array(),
	visit_result: text().array(),
	took_order: boolean().generatedAlwaysAs(sql`('Buyurtma oldim'::text = ANY (visit_result))`),
	no_order_reason: text(),
	debt_status: text(),
	cash_collected: numeric({ precision: 14, scale:  2 }),
	note: text(),
	lat: numeric({ precision: 9, scale:  6 }),
	lng: numeric({ precision: 9, scale:  6 }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("visits_manager_id_visited_at_idx").using("btree", table.manager_id.asc().nullsLast().op("timestamptz_ops"), table.visited_at.desc().nullsFirst().op("uuid_ops")),
	index("visits_store_id_visited_at_idx").using("btree", table.store_id.asc().nullsLast().op("int8_ops"), table.visited_at.desc().nullsFirst().op("int8_ops")),
	foreignKey({
			columns: [table.manager_id],
			foreignColumns: [users.id],
			name: "visits_manager_id_fkey"
		}),
	foreignKey({
			columns: [table.store_id],
			foreignColumns: [stores.id],
			name: "visits_store_id_fkey"
		}),
	pgPolicy("v_update", { as: "permissive", for: "update", to: ["public"], using: sql`((manager_id = current_user_id()) AND (visited_at > (now() - '24:00:00'::interval)))` }),
	pgPolicy("v_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("v_read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const books = pgTable("books", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	title: text().notNull(),
	active: boolean().default(true).notNull(),
}, (table) => [
	unique("books_title_key").on(table.title),
	pgPolicy("b_write", { as: "permissive", for: "all", to: ["public"], using: sql`can_manage_users()`, withCheck: sql`can_manage_users()`  }),
	pgPolicy("b_read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const visit_photos = pgTable("visit_photos", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	visit_id: uuid().notNull(),
	object_key: text().notNull(),
	content_type: text(),
	bytes: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.visit_id],
			foreignColumns: [visits.id],
			name: "visit_photos_visit_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("vp_all", { as: "permissive", for: "all", to: ["public"], using: sql`(visit_id IN ( SELECT visits.id
   FROM visits))`, withCheck: sql`(visit_id IN ( SELECT visits.id
   FROM visits
  WHERE (visits.manager_id = current_user_id())))`  }),
]);

export const visit_books = pgTable("visit_books", {
	visit_id: uuid().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	book_id: bigint({ mode: "number" }).notNull(),
	status: book_status().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.visit_id],
			foreignColumns: [visits.id],
			name: "visit_books_visit_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.book_id],
			foreignColumns: [books.id],
			name: "visit_books_book_id_fkey"
		}),
	primaryKey({ columns: [table.visit_id, table.book_id, table.status], name: "visit_books_pkey"}),
	pgPolicy("vb_all", { as: "permissive", for: "all", to: ["public"], using: sql`(visit_id IN ( SELECT visits.id
   FROM visits))`, withCheck: sql`(visit_id IN ( SELECT visits.id
   FROM visits
  WHERE (visits.manager_id = current_user_id())))`  }),
]);
export const v_bugungi_reja = pgView("v_bugungi_reja", {	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	store_id: bigint({ mode: "number" }),
	code: text(),
	region: text(),
	owner_id: uuid(),
	oxirgi_vizit: timestamp({ withTimezone: true, mode: 'string' }),
	kun_otdi: integer(),
	visit_every_days: integer(),
}).as(sql`SELECT s.id AS store_id, s.code, s.region, s.owner_id, max(v.visited_at) AS oxirgi_vizit, COALESCE(date_part('day'::text, now() - max(v.visited_at))::integer, 999) AS kun_otdi, s.visit_every_days FROM stores s LEFT JOIN visits v ON v.store_id = s.id WHERE s.active GROUP BY s.id HAVING COALESCE(date_part('day'::text, now() - max(v.visited_at))::integer, 999) >= s.visit_every_days`);

export const v_manager_kunlik = pgView("v_manager_kunlik", {	manager_id: uuid(),
	full_name: text(),
	kun: timestamp({ withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	vizitlar: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	buyurtmalar: bigint({ mode: "number" }),
	yigilgan_pul: numeric(),
}).as(sql`SELECT u.id AS manager_id, u.full_name, date_trunc('day'::text, v.visited_at) AS kun, count(v.id) AS vizitlar, count(*) FILTER (WHERE v.took_order) AS buyurtmalar, sum(v.cash_collected) AS yigilgan_pul FROM users u LEFT JOIN visits v ON v.manager_id = u.id WHERE u.role = 'sotuv_manager'::user_role GROUP BY u.id, u.full_name, (date_trunc('day'::text, v.visited_at))`);

export const v_turib_qolgan = pgView("v_turib_qolgan", {	title: text(),
	region: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	marta: bigint({ mode: "number" }),
	oxirgi: timestamp({ withTimezone: true, mode: 'string' }),
}).as(sql`SELECT b.title, s.region, count(*) AS marta, max(v.visited_at) AS oxirgi FROM visit_books vb JOIN visits v ON v.id = vb.visit_id JOIN books b ON b.id = vb.book_id JOIN stores s ON s.id = v.store_id WHERE vb.status = 'stale'::book_status AND v.visited_at > (now() - '90 days'::interval) GROUP BY b.title, s.region ORDER BY (count(*)) DESC`);