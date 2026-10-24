import { handleSendEmailHookForRequest } from '@jadarat/platform-identity/auth';
import { definePublicRoute } from '@jadarat/platform-rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Supabase Auth's Send Email hook (WP-ADM-05; docs/engineering/production-setup.md, the hook step). Auth POSTs
 * every e-mail it would send here, signed (standard-webhooks, SEND_EMAIL_HOOK_SECRET); the sign-in code is sent
 * at once through the organization's sender or the platform sender, every other type is refused. No session,
 * no cookies: the signature is the only credential. Never cached, never logged with an address or a code.
 */
export const POST = definePublicRoute({
  name: 'platform.identity.send_email_hook',
  handler: async (request) => {
    const { status, body } = await handleSendEmailHookForRequest(request);
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  },
});
