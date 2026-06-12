ALTER TABLE "users" ADD COLUMN "device_id" text;--> statement-breakpoint
CREATE INDEX "users_device_id_idx" ON "users" USING btree ("device_id");