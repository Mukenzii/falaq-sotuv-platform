import { relations } from "drizzle-orm/relations";
import { users, stores, visits, visit_photos, visit_books, books } from "./schema";

export const usersRelations = relations(users, ({one, many}) => ({
	user: one(users, {
		fields: [users.parent_id],
		references: [users.id],
		relationName: "users_parent_id_users_id"
	}),
	users: many(users, {
		relationName: "users_parent_id_users_id"
	}),
	stores: many(stores),
	visits: many(visits),
}));

export const storesRelations = relations(stores, ({one, many}) => ({
	user: one(users, {
		fields: [stores.owner_id],
		references: [users.id]
	}),
	visits: many(visits),
}));

export const visitsRelations = relations(visits, ({one, many}) => ({
	user: one(users, {
		fields: [visits.manager_id],
		references: [users.id]
	}),
	store: one(stores, {
		fields: [visits.store_id],
		references: [stores.id]
	}),
	visit_photos: many(visit_photos),
	visit_books: many(visit_books),
}));

export const visit_photosRelations = relations(visit_photos, ({one}) => ({
	visit: one(visits, {
		fields: [visit_photos.visit_id],
		references: [visits.id]
	}),
}));

export const visit_booksRelations = relations(visit_books, ({one}) => ({
	visit: one(visits, {
		fields: [visit_books.visit_id],
		references: [visits.id]
	}),
	book: one(books, {
		fields: [visit_books.book_id],
		references: [books.id]
	}),
}));

export const booksRelations = relations(books, ({many}) => ({
	visit_books: many(visit_books),
}));