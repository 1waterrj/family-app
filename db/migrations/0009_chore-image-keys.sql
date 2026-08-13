ALTER TABLE "chore_templates" ADD COLUMN "image_key" varchar(64);
ALTER TABLE "chore_instances" ADD COLUMN "image_key" varchar(64);

ALTER TABLE "chore_templates"
  ADD CONSTRAINT "chore_templates_image_key_known"
  CHECK (
    "image_key" IS NULL OR "image_key" IN (
      'tidy-toys', 'dishes', 'set-table', 'laundry',
      'feed-pet', 'make-bed', 'wipe-counter', 'help-garden'
    )
  ) NOT VALID;

ALTER TABLE "chore_instances"
  ADD CONSTRAINT "chore_instances_image_key_known"
  CHECK (
    "image_key" IS NULL OR "image_key" IN (
      'tidy-toys', 'dishes', 'set-table', 'laundry',
      'feed-pet', 'make-bed', 'wipe-counter', 'help-garden'
    )
  ) NOT VALID;
