-- Conditional-request validators saved before the ambiguity gate were earned
-- by extractions that gate would now refuse. A listing still holding one keeps
-- answering 304, which is a healthy check that runs no extraction, so the
-- suspect price would never be re-evaluated and no repair would be prompted.
-- Clearing them costs one unconditional fetch per listing on its next check.
UPDATE "listings" SET "etag" = NULL, "last_modified" = NULL WHERE "etag" IS NOT NULL OR "last_modified" IS NOT NULL;
