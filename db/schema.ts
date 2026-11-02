import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const studies = sqliteTable('studies', {
 ownerId: text('owner_id').notNull(), id: text('id').notNull(), payload: text('payload').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [primaryKey({columns:[t.ownerId,t.id]})]);
export const documents = sqliteTable('documents', {
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),name:text('name').notNull(),company:text('company').notNull(),ticker:text('ticker').notNull(),period:text('period').notNull(),mime:text('mime').notNull(),size:integer('size').notNull(),storageKey:text('storage_key').notNull(),textKey:text('text_key').notNull(),pageCount:integer('page_count').notNull(),extractionStatus:text('extraction_status').notNull(),createdAt:text('created_at').notNull(),
}, (t)=>[primaryKey({columns:[t.ownerId,t.id]})]);
