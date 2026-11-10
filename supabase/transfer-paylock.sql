-- Awaiting payment (Alex, 10 Nov 2026): a sender can lock a link they sent until the client has paid. While pay_lock is
-- on, roar-transfer-get hands out no file address and no preview for it (the page shows a kind "Almost there" instead,
-- with who sent it, the title and the file names), and its ?dl=1 downloads go back to the link's page. Turning it off
-- makes the same link work again at once. The admins still open it.
-- RoarTransfer: on the upload link (roar_transfer_bundles) and on each of its files (roar_transfer_links), so a file's
-- own link is locked too; set and cleared by roartransfer-pro 'edit' (Details) and by roartransfer-r2 'bundle' (when
-- sending). Studio: on a share link (roarstudio_shares), set and cleared by roarstudio 'share-paylock'.
-- Only the Edge Functions write these columns (none of these tables can be updated from the page). Safe to run again.
alter table public.roar_transfer_bundles add column if not exists pay_lock boolean not null default false;
alter table public.roar_transfer_links add column if not exists pay_lock boolean not null default false;
alter table public.roarstudio_shares add column if not exists pay_lock boolean not null default false;
