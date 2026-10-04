# Prints every stored event of the "suite" project as one JSON line (used by smoke.sh to check that
# events arrive and contain no personal data).
import json

from apps.issue_events.models import IssueEvent

for event in IssueEvent.objects.filter(issue__project__slug="suite").order_by("timestamp"):
    print(json.dumps(event.data, default=str))
