CREATE TABLE `documents` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`company` text NOT NULL,
	`ticker` text NOT NULL,
	`period` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`text_key` text NOT NULL,
	`page_count` integer NOT NULL,
	`extraction_status` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `studies` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
