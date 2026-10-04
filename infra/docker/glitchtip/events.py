# Prints every stored event of the "suite" project as one JSON line — its payload and the separately
# stored fields (tags, titles, transaction, issue culprit) — so smoke.sh can check that events arrive and
# contain no personal data anywhere.
import json

from apps.issue_events.models import IssueEvent

for event in (
    IssueEvent.objects.filter(issue__project__slug="suite")
    .select_related("issue")
    .order_by("timestamp")
):
    print(
        json.dumps(
            {
                "data": event.data,
                "tags": getattr(event, "tags", None),
                "title": getattr(event, "title", None),
                "transaction": getattr(event, "transaction", None),
                "issue_title": event.issue.title,
                "issue_culprit": getattr(event.issue, "culprit", None),
                "issue_metadata": getattr(event.issue, "metadata", None),
            },
            default=str,
        )
    )
