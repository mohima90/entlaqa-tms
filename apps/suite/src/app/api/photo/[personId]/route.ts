import { personPhotoResponse } from '../../../../lib/person-photo-route';

export const dynamic = 'force-dynamic';

/**
 * A person's profile photo (WP-ADM-04, FR-IAM-16): the copy without hidden details that the person published
 * on My profile — private, for signed-in members of the SAME organization only (never a public link: the
 * session is verified and the database answers nothing to another organization), on the app's own origin so
 * the page policy (`img-src 'self'`) holds. See person-photo-route.ts.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ personId: string }> },
): Promise<Response> {
  const { personId } = await params;
  return personPhotoResponse(request, personId);
}
