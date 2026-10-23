-- RoarTransfer download limits (Alex, 23 Oct 2026: "FastTransfer 1 download, the rest 5, so Pro has something to sell").
-- Each file link may say how many times it can be downloaded; null is no limit (older links, the admins' own).
-- roartransfer-r2 sets it when the file is made (no account 1, an account 5); roar-transfer-get counts each download on
-- the server and stops giving the file once it is reached. Safe to run again.
alter table public.roar_transfer_links add column if not exists max_downloads int;
