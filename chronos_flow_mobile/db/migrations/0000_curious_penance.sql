CREATE TABLE `backlog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`space_id` text,
	`title` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'INBOX' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`start_date` integer,
	`target_date` integer,
	`context` text,
	`ai_plan` text,
	`ai_model` text,
	`ai_planned_at` integer,
	`converted_node_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backlog_user_status_pos` ON `backlog_items` (`user_id`,`status`,`position`);--> statement-breakpoint
CREATE TABLE `backlog_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`backlog_item_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`hours_per_week` integer,
	`headcount` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`backlog_item_id`) REFERENCES `backlog_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backlog_roles_item_pos` ON `backlog_roles` (`backlog_item_id`,`position`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`email` text,
	`whatsapp` text,
	`training_level` text DEFAULT 'NOT_STARTED' NOT NULL,
	`capacity_hours_week` integer DEFAULT 40 NOT NULL,
	`color` text DEFAULT '#6366F1' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `members_user` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `node_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`actor` text DEFAULT 'Voce' NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_node_data` ON `node_activity` (`node_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `node_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`type` text DEFAULT 'FINISH_TO_START' NOT NULL,
	`lag_days` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`blocker_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dep_par` ON `node_dependencies` (`blocker_id`,`blocked_id`);--> statement-breakpoint
CREATE INDEX `dep_blocked` ON `node_dependencies` (`blocked_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`space_id` text,
	`parent_id` text,
	`path` text DEFAULT '' NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`manual_progress` real,
	`leaf_count` integer DEFAULT 0 NOT NULL,
	`rollup_dirty` integer DEFAULT false NOT NULL,
	`start_date` integer,
	`due_date` integer,
	`all_day` integer DEFAULT true NOT NULL,
	`estimated_minutes` integer,
	`planned_date` integer,
	`scheduled_start` text,
	`scheduled_end` text,
	`completed_at` integer,
	`importance` integer DEFAULT 3 NOT NULL,
	`root_impact` real DEFAULT 0 NOT NULL,
	`assignee_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `nodes_user_path` ON `nodes` (`user_id`,`path`);--> statement-breakpoint
CREATE INDEX `nodes_parent_pos` ON `nodes` (`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `nodes_assignee_status` ON `nodes` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `nodes_space_depth` ON `nodes` (`space_id`,`depth`);--> statement-breakpoint
CREATE INDEX `nodes_planned` ON `nodes` (`planned_date`);--> statement-breakpoint
CREATE TABLE `progress_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`progress` real NOT NULL,
	`leaf_effort` integer DEFAULT 0 NOT NULL,
	`captured_on` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_no_dia` ON `progress_snapshots` (`node_id`,`captured_on`);--> statement-breakpoint
CREATE INDEX `snapshot_dia` ON `progress_snapshots` (`captured_on`);--> statement-breakpoint
CREATE TABLE `space_members` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_members_par` ON `space_members` (`space_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT '#10B981' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `spaces_user_position` ON `spaces` (`user_id`,`position`);--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`space_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`weight` integer DEFAULT 1 NOT NULL,
	`estimated_minutes` integer,
	`importance` integer DEFAULT 3 NOT NULL,
	`assignee_id` text,
	`color` text DEFAULT '#6366F1' NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `templates_user_space_pos` ON `task_templates` (`user_id`,`space_id`,`position`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`birth_date` integer NOT NULL,
	`life_expectancy` integer DEFAULT 75 NOT NULL,
	`daily_focus_goal_minutes` integer DEFAULT 240 NOT NULL,
	`daily_impact_goal` real DEFAULT 1 NOT NULL,
	`timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`gemini_api_key` text,
	`gemini_model` text DEFAULT 'gemini-2.5-flash' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
