CREATE TABLE `preferencias` (
	`chave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `nodes` ADD `alarme` integer DEFAULT false NOT NULL;