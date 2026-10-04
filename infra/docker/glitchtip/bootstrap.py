# One-time GlitchTip set-up for this installation (run by smoke.sh; operators: see README.md):
#   docker compose exec -T -e GLITCHTIP_ADMIN_EMAIL=… -e GLITCHTIP_ADMIN_PASSWORD=… glitchtip \
#     python manage.py shell < glitchtip/bootstrap.py
# Creates (idempotently) the operator account, the organization "jadarat" and the project "suite", and
# prints the DSN the app uses — with the INTERNAL host (glitchtip:8000), never the UI address.
import os

from allauth.account.models import EmailAddress
from apps.organizations_ext.models import Organization
from apps.projects.models import Project, ProjectKey
from apps.teams.models import Team
from apps.users.models import User

email = os.environ["GLITCHTIP_ADMIN_EMAIL"]
password = os.environ["GLITCHTIP_ADMIN_PASSWORD"]

user = User.objects.filter(email=email).first()
if user is None:
    user = User.objects.create_superuser(email=email, password=password)
EmailAddress.objects.get_or_create(
    user=user, email=email, defaults={"primary": True, "verified": True}
)

org, _ = Organization.objects.get_or_create(slug="jadarat", defaults={"name": "Jadarat"})
if not org.users.filter(pk=user.pk).exists():
    org.add_user(user)
project, _ = Project.objects.get_or_create(
    slug="suite", organization=org, defaults={"name": "suite"}
)
team, _ = Team.objects.get_or_create(slug="operators", organization=org)
team.members.add(org.organization_users.get(user=user))
team.projects.add(project)

key = ProjectKey.objects.filter(project=project).first() or ProjectKey.objects.create(
    project=project
)
print(f"DSN=http://{key.public_key_hex}@glitchtip:8000/{project.id}")
