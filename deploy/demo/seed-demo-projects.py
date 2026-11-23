#!/usr/bin/env python3
"""Seeds a cold-seance deployment with demo projects over the REST API, creating only what is missing.

The 30 demo accounts (DEMO_USERNAMES) must already exist: they are created beforehand, with
strong passwords, and this script never creates or changes an account's password. It checks
that every one exists before it changes anything, and stops if any is missing.

It then makes sure that each of these exists, creating it only if it does not:
- company holidays on the coming 24, 25 and 31 December and 1 January;
- a capacity of 50, 80 or 100 % on 10 of the demo accounts;
- 6 groups, each with 6 demo members in mixed roles (members are added only to a group it creates);
- 64 demo projects (a few with long names), found by name. A project that already exists is left
  as it is. A missing one is created with its members, groups and tasks (dates relative to today,
  durations, effort, AI share, assignees, eligibility, fixed-date milestones, blockers, subtasks,
  every status, a few cancelled) and, for some, a baseline with changed durations afterwards, an
  AI proposal waiting for review, a saved view and the admin's subscription;
- a personal cross-project Gantt view of the admin's, found by name.

It registers no repositories and asks for none. It deletes nothing: the live tests' projects are
deleted separately.

Settings, from the environment:
  SEED_URL             the deployment, e.g. http://localhost:3000 (default)
  SEED_ADMIN_USERNAME  a system admin (default root)
  SEED_ADMIN_PASSWORD  their password (required)

Exit status: 0 when done, 1 when a demo account is missing or the admin cannot sign in.
Uses only the Python standard library. Every project's content comes from a random seed fixed by
its name, so a project made again looks the same, apart from dates, which move with the day of the run.
"""
import datetime, json, os, random, sys, urllib.error, urllib.request

BASE = os.environ.get('SEED_URL', 'http://localhost:3000').rstrip('/') + '/api'
ADMIN = os.environ.get('SEED_ADMIN_USERNAME', 'root')
ADMIN_PASSWORD = os.environ.get('SEED_ADMIN_PASSWORD')
COOKIE = {}

DEMO_USERNAMES = ['anna','bela','csaba','dora','emese','ferenc','gabor','hajnal','istvan','julia','kata','laszlo','marta','nora','oliver','peter','reka','sandor','tamas','ursula','viktor','zsofia','adam','brigitta','daniel','eszter','gergely','helga','imre','jozsef']
GROUPS = ['Platform Engineering', 'Mobile', 'Customer Success Tools', 'Data & Analytics', 'Infrastructure', 'Marketing Web']
GANTT_VIEW = 'Everything across Billing'
TITLES = ['Write spec','Design review','Implement API endpoint','Database migration','Frontend form','Write unit tests','Security review','Load testing','Update documentation','Deploy to staging','QA sign-off','Fix flaky tests','Refactor service layer','Accessibility audit','Translate strings','Customer interviews','Prototype','Performance profiling','Set up monitoring','Data backfill','Feature flag cleanup','Release notes','Handle edge case where the user has no saved payment method and the session expires mid-checkout']


def demo_project_names():
    """The 64 demo project names, the same on every run, sorted."""
    rng = random.Random(7)
    areas = ['Billing','Checkout','Onboarding','Search','Reporting','Notifications','Identity','Payments','Inventory','Warehouse','Mobile App','Analytics','Data Pipeline','Partner Portal','Admin Console','Design System','Localization','Mailer','Scheduler','CRM Sync']
    kinds = ['Revamp','v2','Migration','2027 Q1','Hardening','Rollout','Pilot','Redesign','Integration','Cleanup']
    names = set()
    while len(names) < 64:
        n = f'{rng.choice(areas)} {rng.choice(kinds)}'
        if rng.random() < 0.15: n += ' â€” cross-team initiative with legal and finance sign-off'
        names.add(n)
    return sorted(names)


def req(method, path, body=None, report=True, bearer=None):
    headers = {}
    if body is not None: headers['content-type'] = 'application/json'
    if bearer: headers['authorization'] = 'Bearer ' + bearer
    elif 'c' in COOKIE: headers['cookie'] = COOKIE['c']
    r = urllib.request.Request(BASE + path, method=method, headers=headers,
                               data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r) as f:
            cookie = f.headers.get('set-cookie')
            if cookie: COOKIE['c'] = cookie.split(';')[0]
            text = f.read()
            return json.loads(text) if text else True
    except urllib.error.HTTPError as e:
        if report: print('refused', method, path, e.code, e.read().decode()[:200])
        return None


def items(value, key):
    return value if isinstance(value, list) else value[key]


def working_day(d):
    while d.weekday() >= 5: d += datetime.timedelta(days=1)
    return d


def coming(today, month, day):
    d = datetime.date(today.year, month, day)
    return d if d >= today else datetime.date(today.year + 1, month, day)


def create_project(index, name, group_ids, accounts, anchor, created):
    """Creates one demo project with everything in it; its content is seeded by its name."""
    rng = random.Random(name)
    p = req('POST', '/projects', {'name': name, 'groupIds': rng.sample(group_ids, min(len(group_ids), rng.choice([0, 1, 1, 2])))})
    if not p: return None
    pid = p['id']
    members = rng.sample(DEMO_USERNAMES, rng.randint(3, 9))
    for u in members:
        req('POST', f'/projects/{pid}/members', {'username': u, 'role': rng.choice(['read-only','contributor','read-write','admin','read-write'])}, report=False)
    member_ids = [accounts[u] for u in members]
    tasks = []
    for ti in range(rng.randint(25, 45) if index < 9 else rng.randint(4, 12)):
        body = {'title': rng.choice(TITLES) + ('' if rng.random() < 0.6 else f' #{ti}'),
                'description': 'Some description of the work.' if rng.random() < 0.5 else ''}
        if rng.random() < 0.08:
            body['milestone'] = {'variant': 'fixed-date', 'date': str(working_day(anchor + datetime.timedelta(days=rng.randint(10, 80))))}
        else:
            if rng.random() < 0.85:
                body.update(plannedStart=str(working_day(anchor + datetime.timedelta(days=rng.randint(-20, 60)))), durationWorkingDays=rng.randint(1, 15))
            body['effort'] = rng.randint(1, 20)
            if rng.random() < 0.3: body['aiShare'] = rng.choice([20, 50, 100])
            if rng.random() < 0.75: body['assignees'] = rng.sample(member_ids, rng.choice([1, 1, 2]))
            if rng.random() < 0.3: body['eligibility'] = {'any': rng.sample(member_ids, 2)}
        # A start or milestone on a company holiday is refused; that task is simply left out.
        t = req('POST', f'/projects/{pid}/tasks', body, report=False)
        if t: tasks.append((t['id'], 'milestone' in body))
    for i, (tid, milestone) in enumerate(tasks):
        if i > 2 and rng.random() < 0.25:
            req('POST', f'/tasks/{tid}/blocked-by', {'blockerId': rng.choice(tasks[:i])[0]}, report=False)
        if i > 3 and not milestone and rng.random() < 0.12:
            req('PUT', f'/tasks/{tid}/parent', {'parentId': tasks[rng.randint(0, 2)][0]}, report=False)
        if milestone: continue
        r = rng.random()
        steps = (['in-progress'] if r < 0.3 else ['in-progress', 'done'] if r < 0.45 else ['in-progress', 'on-hold'] if r < 0.5 else [])
        for s in steps: req('PUT', f'/tasks/{tid}/status', {'status': s}, report=False)
        if 0.5 <= r < 0.53: req('POST', f'/tasks/{tid}/cancel', {}, report=False)
    if index < 5 and tasks:
        req('POST', f'/projects/{pid}/baselines', {'name': 'Kick-off plan'})
        for tid, milestone in tasks[:6]:
            if not milestone: req('PATCH', f'/tasks/{tid}', {'durationWorkingDays': rng.randint(5, 20)}, report=False)
    if index < 3 and len(tasks) >= 2:
        created['proposals'].append((pid, tasks[0][0], tasks[1][0]))
    if index < 4:
        req('POST', '/saved-views', {'name': 'My open work', 'kind': 'kanban', 'keptIn': 'project', 'projectId': pid,
                                     'filter': [{'field': 'assignees', 'operator': 'contains', 'value': {'viewer': True}}]})
    if index % 7 == 0: req('PUT', f'/subscriptions/projects/{pid}', {}, report=False)
    return pid


def main():
    if not ADMIN_PASSWORD: sys.exit('SEED_ADMIN_PASSWORD is not set')
    if not req('POST', '/session', {'username': ADMIN, 'password': ADMIN_PASSWORD}):
        sys.exit(f'Cannot sign in as {ADMIN}')

    # The demo accounts must all exist before anything is changed.
    existing = {a['username']: a['id'] for a in items(req('GET', '/accounts'), 'accounts')}
    missing = [u for u in DEMO_USERNAMES if u not in existing]
    if missing:
        sys.exit(f'Missing demo accounts, create them first: {", ".join(missing)}')
    accounts = {u: existing[u] for u in DEMO_USERNAMES}

    today = datetime.date.today()
    anchor = today - datetime.timedelta(days=21)  # the plan runs from about 6 weeks ago to 3 months ahead

    holidays = [str(coming(today, 12, 24)), str(coming(today, 12, 25)), str(coming(today, 12, 31)), str(coming(today, 1, 1))]
    calendar = json.dumps(req('GET', '/calendar'))
    new_holidays = [h for h in holidays if h not in calendar]
    if new_holidays: req('PATCH', '/calendar', {'addHolidays': new_holidays})

    rng = random.Random(7)
    for u in DEMO_USERNAMES[:10]:
        capacity = rng.choice([50, 80, 100])
        current = req('GET', f'/accounts/{accounts[u]}/capacity')
        if not current or current.get('capacity') != capacity:
            req('PUT', f'/accounts/{accounts[u]}/capacity', {'capacity': capacity})

    groups = {g['name']: g['id'] for g in items(req('GET', '/groups'), 'groups')}
    for g in GROUPS:
        if g in groups: continue
        made = req('POST', '/groups', {'name': g})
        if not made: continue
        groups[g] = made['id']
        grng = random.Random(g)
        for u in grng.sample(DEMO_USERNAMES, 6):
            req('POST', f'/groups/{made["id"]}/members', {'username': u, 'role': grng.choice(['read-only', 'contributor', 'read-write', 'admin'])}, report=False)
    group_ids = [groups[g] for g in GROUPS if g in groups]

    projects = {p['name']: p['id'] for p in items(req('GET', '/projects'), 'projects')}
    created = {'projects': [], 'proposals': []}
    for index, name in enumerate(demo_project_names()):
        if name in projects: continue
        pid = create_project(index, name, group_ids, accounts, anchor, created)
        if pid:
            projects[name] = pid
            created['projects'].append(name)

    views = items(req('GET', '/saved-views'), 'views')
    if not any(v.get('name') == GANTT_VIEW for v in views):
        covered = [projects[n] for n in demo_project_names()[:5] if n in projects]
        req('POST', '/saved-views', {'name': GANTT_VIEW, 'kind': 'gantt', 'keptIn': 'personal', 'projects': covered, 'filter': []})

    # Proposals come in only through the REST API or the MCP server, with a token, revoked afterwards.
    if created['proposals']:
        token = req('POST', '/tokens', {})
        for pid, first, second in created['proposals']:
            req('POST', '/proposals', bearer=token['secret'], body={'groups': [
                {'changes': [{'kind': 'create-task', 'key': 'n1', 'projectId': pid, 'fields': {'title': 'Proposed: add caching layer', 'durationWorkingDays': 5}},
                             {'kind': 'add-blocker', 'task': {'newTask': 'n1'}, 'blocker': {'taskId': second}}]},
                {'changes': [{'kind': 'update-task', 'task': {'taskId': first}, 'fields': {'title': 'Renamed by proposal', 'durationWorkingDays': 12}}]}]})
        req('DELETE', f'/tokens/{token["token"]["id"]}')

    print(f'{len(created["projects"])} demo projects created, {64 - len(created["projects"])} already there')


main()
