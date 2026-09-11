-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."book_status" AS ENUM('present', 'stale');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('direktor', 'sotuv_boshligi', 'hudud_rahbari', 'sotuv_manager');--> statement-breakpoint
CREATE TYPE "public"."visit_facing" AS ENUM('face', 'qisman_face', 'koreshok');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_username" text,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" "user_role" DEFAULT 'sotuv_manager' NOT NULL,
	"parent_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_key" UNIQUE("telegram_id"),
	CONSTRAINT "users_phone_key" UNIQUE("phone"),
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "no_self_parent" CHECK (id <> parent_id)
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"channel" text,
	"letter_code" text,
	"owner_id" uuid,
	"visit_every_days" integer DEFAULT 14 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "stores_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"store_id" bigint NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"width_m" numeric(5, 2),
	"height_m" numeric(5, 2),
	"area_m2" numeric(7, 2) GENERATED ALWAYS AS ((width_m * height_m)) STORED,
	"open_from" time,
	"open_to" time,
	"placement" text[],
	"facing" "visit_facing",
	"shelf_heights" text[],
	"visit_result" text[],
	"took_order" boolean GENERATED ALWAYS AS (('Buyurtma oldim'::text = ANY (visit_result))) STORED,
	"no_order_reason" text,
	"debt_status" text,
	"cash_collected" numeric(14, 2),
	"note" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "books" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "books_title_key" UNIQUE("title")
);
--> statement-breakpoint
ALTER TABLE "books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visit_photos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text,
	"bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visit_books" (
	"visit_id" uuid NOT NULL,
	"book_id" bigint NOT NULL,
	"status" "book_status" NOT NULL,
	CONSTRAINT "visit_books_pkey" PRIMARY KEY("visit_id","book_id","status")
);
--> statement-breakpoint
ALTER TABLE "visit_books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_books" ADD CONSTRAINT "visit_books_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_books" ADD CONSTRAINT "visit_books_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_parent_id_idx" ON "users" USING btree ("parent_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "stores_owner_id_idx" ON "stores" USING btree ("owner_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "stores_region_idx" ON "stores" USING btree ("region" text_ops);--> statement-breakpoint
CREATE INDEX "visits_manager_id_visited_at_idx" ON "visits" USING btree ("manager_id" timestamptz_ops,"visited_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "visits_store_id_visited_at_idx" ON "visits" USING btree ("store_id" int8_ops,"visited_at" int8_ops);--> statement-breakpoint
CREATE VIEW "public"."v_bugungi_reja" AS (SELECT s.id AS store_id, s.code, s.region, s.owner_id, max(v.visited_at) AS oxirgi_vizit, COALESCE(date_part('day'::text, now() - max(v.visited_at))::integer, 999) AS kun_otdi, s.visit_every_days FROM stores s LEFT JOIN visits v ON v.store_id = s.id WHERE s.active GROUP BY s.id HAVING COALESCE(date_part('day'::text, now() - max(v.visited_at))::integer, 999) >= s.visit_every_days);--> statement-breakpoint
CREATE VIEW "public"."v_manager_kunlik" AS (SELECT u.id AS manager_id, u.full_name, date_trunc('day'::text, v.visited_at) AS kun, count(v.id) AS vizitlar, count(*) FILTER (WHERE v.took_order) AS buyurtmalar, sum(v.cash_collected) AS yigilgan_pul FROM users u LEFT JOIN visits v ON v.manager_id = u.id WHERE u.role = 'sotuv_manager'::user_role GROUP BY u.id, u.full_name, (date_trunc('day'::text, v.visited_at)));--> statement-breakpoint
CREATE VIEW "public"."v_turib_qolgan" AS (SELECT b.title, s.region, count(*) AS marta, max(v.visited_at) AS oxirgi FROM visit_books vb JOIN visits v ON v.id = vb.visit_id JOIN books b ON b.id = vb.book_id JOIN stores s ON s.id = v.store_id WHERE vb.status = 'stale'::book_status AND v.visited_at > (now() - '90 days'::interval) GROUP BY b.title, s.region ORDER BY (count(*)) DESC);--> statement-breakpoint
CREATE POLICY "u_delete" ON "users" AS PERMISSIVE FOR DELETE TO public USING ((can_manage_users() AND (id <> current_user_id())));--> statement-breakpoint
CREATE POLICY "u_update" ON "users" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "u_insert" ON "users" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "u_read" ON "users" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "s_write" ON "stores" AS PERMISSIVE FOR ALL TO public USING (can_manage_users()) WITH CHECK (can_manage_users());--> statement-breakpoint
CREATE POLICY "s_read" ON "stores" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "v_update" ON "visits" AS PERMISSIVE FOR UPDATE TO public USING (((manager_id = current_user_id()) AND (visited_at > (now() - '24:00:00'::interval))));--> statement-breakpoint
CREATE POLICY "v_insert" ON "visits" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "v_read" ON "visits" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "b_write" ON "books" AS PERMISSIVE FOR ALL TO public USING (can_manage_users()) WITH CHECK (can_manage_users());--> statement-breakpoint
CREATE POLICY "b_read" ON "books" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "vp_all" ON "visit_photos" AS PERMISSIVE FOR ALL TO public USING ((visit_id IN ( SELECT visits.id
   FROM visits))) WITH CHECK ((visit_id IN ( SELECT visits.id
   FROM visits
  WHERE (visits.manager_id = current_user_id()))));--> statement-breakpoint
CREATE POLICY "vb_all" ON "visit_books" AS PERMISSIVE FOR ALL TO public USING ((visit_id IN ( SELECT visits.id
   FROM visits))) WITH CHECK ((visit_id IN ( SELECT visits.id
   FROM visits
  WHERE (visits.manager_id = current_user_id()))));
*/