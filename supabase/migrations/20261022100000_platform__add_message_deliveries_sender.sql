-- Which sender a delivery went out with (WP-ADM-01, FR-NTF-11; EP-EMAIL flow agreed by the PO on 17 Oct 2026):
-- the organization's own provider («organization»), the platform sender set by the Super Admin («platform»)
-- or the installation's sender from the worker's environment (self-hosted relays, «installation»). Written
-- by the e-mail sender with the outcome (sent or failed), so the Organization Admin's Email integration page
-- can show whose sender a delivery error belongs to — there is no automatic switch to another sender (PO,
-- 17 Oct 2026). Expand-first: nullable, older rows and the previous sender leave it empty. Class: T. PII: none.

alter table platform.message_deliveries
  add column sender text,
  add constraint message_deliveries_sender_check
    check (sender is null or sender in ('organization', 'platform', 'installation'));

comment on column platform.message_deliveries.sender is
  'The sender a delivery went out with (organization / platform / installation; FR-NTF-11, WP-ADM-01); null before it was tried.';
