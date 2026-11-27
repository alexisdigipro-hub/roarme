-- RoarTransfer Brand (Alex, 27 Nov 2026: "a tab for the company: colours, background, logos, all customizable, their own
-- UI and what they send in their own colours"). A Pro's look beside their name, logo and backgrounds:
-- { accent: '#rrggbb', glass: 0..100 (how solid the card is), font: 'jost' | 'sans' | 'serif', self: true (their own
-- RoarTransfer in their brand too) }. Written only by roartransfer-pro 'brand'; read by roar-transfer-get for their links.
-- Safe to run again.
alter table public.roar_transfer_pro add column if not exists brand_style jsonb not null default '{}'::jsonb;
