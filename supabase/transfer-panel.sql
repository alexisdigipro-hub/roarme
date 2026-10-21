-- RoarTransfer panel (Alex, 21 Oct 2026): Settings > RoarTransfer lists what each person sent (roar_my_transfers),
-- Settings > Admin > RoarTransfer lists everyone's with the totals (roar_admin_transfers, roar_admin_transfer_stats).
-- Those functions, roar_transfer_items, roar_transfer_stop and the opens / downloads / last_download / stopped_at
-- columns of roar_transfer_links are already in the database. This file lets the public download page (?t=…, signed
-- out) count its own opens and downloads through roar_transfer_hit. Safe to run again.

alter function public.roar_transfer_hit(text, boolean) security definer;
alter function public.roar_transfer_hit(text, boolean) set search_path = public;
revoke all on function public.roar_transfer_hit(text, boolean) from public;
grant execute on function public.roar_transfer_hit(text, boolean) to anon, authenticated;
