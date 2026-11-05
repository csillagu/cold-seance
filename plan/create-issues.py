#!/usr/bin/env python3
"""Create the GitHub issues of the parallel work graph, with their "blocked by" relations.

Reads plan/work-graph.yaml and creates one issue per node, in an order where every blocker
comes first. Each issue gets:

- the label `work-graph`, a lane label (`backend`, `frontend` or `closing`), and `needs-owner`
  when the node has a `needs_owner` question;
- a body with its rank, SCs, TCs (with the part each covers), Blocked by and notes;
- GitHub's "blocked by" relation to each blocker's issue.

The rank orders the nodes for the agents (plan/agent-prompt.md): rank 1 starts the longest chain
of effort still to do. Z01 counts as 0 effort, since most of it is done along the way.

The node-to-issue numbers go to plan/issues.json, so a second run skips the nodes that already
have an issue and only creates the rest.

Without --apply the script only prints what it would do. With --apply it runs `gh`, which must be
logged in with the right to write issues in the repository.

    python3 plan/create-issues.py            # dry run
    python3 plan/create-issues.py --apply    # create the issues
"""

import functools
import json
import os
import subprocess
import sys

import yaml

REPO = 'csillagu/cold-seance'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRAPH = os.path.join(ROOT, 'graph')
NUMBERS = os.path.join(ROOT, 'plan', 'issues.json')
BLOB = f'https://github.com/{REPO}/blob/main'

LABELS = {
    'work-graph': ('5319e7', 'A node of the parallel work graph (plan/work-graph.md)'),
    'claimed': ('fbca04', 'An agent is working on it (plan/agent-prompt.md)'),
    'needs-owner': ('d93f0b', 'Waits for an answer from the owner'),
    'backend': ('1d76db', 'Backend lane of the work graph'),
    'frontend': ('f9a03f', 'Frontend lane of the work graph'),
    'closing': ('0e8a16', 'Closes the work graph'),
}


def item_files():
    files = {}
    for name in os.listdir(GRAPH):
        if name.endswith('.md'):
            files['-'.join(name.split('-')[:2])] = name
    return files


def title_of(file):
    with open(os.path.join(GRAPH, file)) as f:
        for line in f:
            if line.startswith('# '):
                return line[2:].strip().split(': ', 1)[-1]
    return ''


def effort_of(file):
    with open(os.path.join(GRAPH, file)) as f:
        for line in f:
            if line.startswith('effort:'):
                return line.split(':', 1)[1].strip()
    return '?'


def lane(node_id):
    return {'B': 'backend', 'F': 'frontend', 'D': 'frontend', 'P': 'frontend'}.get(node_id[0], 'closing')


def gh(*args, capture=True):
    result = subprocess.run(['gh', *args], check=True, text=True, capture_output=capture)
    return result.stdout.strip() if capture else ''


def main():
    apply = '--apply' in sys.argv[1:]
    with open(os.path.join(ROOT, 'plan', 'work-graph.yaml')) as f:
        nodes = yaml.safe_load(f)['nodes']
    files = item_files()

    for node_id, node in nodes.items():
        for blocker in node['blocked_by']:
            if blocker not in nodes:
                sys.exit(f'{node_id} is blocked by {blocker}, which is not a node')

    weight = {n: 0 if n == 'Z01' else nodes[n]['effort'] for n in nodes}
    successors = {n: [m for m in nodes if n in nodes[m]['blocked_by']] for n in nodes}

    @functools.lru_cache(maxsize=None)
    def chain(n):
        """The effort from the start of n to the end of the longest chain after it."""
        return weight[n] + max((chain(m) for m in successors[n]), default=0)

    ranked = sorted(nodes, key=lambda n: (-chain(n), -weight[n], n))
    rank = {n: i + 1 for i, n in enumerate(ranked)}

    order, seen = [], set()

    def visit(n):
        if n in seen:
            return
        seen.add(n)
        for blocker in nodes[n]['blocked_by']:
            visit(blocker)
        order.append(n)

    for n in ranked:
        visit(n)

    numbers = {}
    if os.path.exists(NUMBERS):
        with open(NUMBERS) as f:
            numbers = json.load(f)

    if apply:
        listed = json.loads(gh('label', 'list', '--repo', REPO, '--limit', '200', '--json', 'name'))
        existing = {label['name'] for label in listed}
        for name, (color, description) in LABELS.items():
            if name not in existing:
                gh('label', 'create', name, '--repo', REPO, '--color', color, '--description', description)

    for n in order:
        node = nodes[n]
        if n in numbers:
            print(f'{n}: already #{numbers[n]}, skipped')
            continue

        lines = [
            f'Node **{n}** of the [parallel work graph]({BLOB}/plan/work-graph.md). '
            f'Agents take it as [`plan/agent-prompt.md`]({BLOB}/plan/agent-prompt.md) sets out.',
            '',
            f'**Rank:** {rank[n]} of {len(nodes)}  ',
            f'**Effort:** {node["effort"]}',
            '',
            '## SCs',
            '',
        ]
        if node['scs']:
            for sc in node['scs']:
                lines.append(f'- [{sc}]({BLOB}/graph/{files[sc]}): {title_of(files[sc])} (effort {effort_of(files[sc])})')
        else:
            lines.append('None: see the notes.')
        lines += ['', '## TCs', '']
        if node['tcs']:
            for tc in node['tcs']:
                part = 'in full' if tc['part'] == 'full' else f'part: {tc["part"]}'
                lines.append(f'- [{tc["tc"]}]({BLOB}/graph/{files[tc["tc"]]}): {title_of(files[tc["tc"]])}. **{part}**')
        else:
            lines.append('None.')
        lines += ['', '## Blocked by', '']
        if node['blocked_by']:
            for blocker in node['blocked_by']:
                ref = f'#{numbers[blocker]}' if blocker in numbers else f'(issue of {blocker})'
                lines.append(f'- {ref} {blocker}: {nodes[blocker]["title"]}')
        else:
            lines.append('Nothing.')
        if node.get('needs_owner'):
            lines += ['', '## Question for the owner', '', node['needs_owner']]
        if node.get('notes'):
            lines += ['', '## Notes', ''] + [f'- {note}' for note in node['notes']]
        body = '\n'.join(lines) + '\n'

        labels = ['work-graph', lane(n)] + (['needs-owner'] if node.get('needs_owner') else [])
        title = f'{n}: {node["title"]}'

        if not apply:
            print(f'--- would create: {title}  [{", ".join(labels)}]  blocked by {node["blocked_by"]}')
            print(body)
            numbers[n] = f'<{n}>'
            continue

        url = gh('issue', 'create', '--repo', REPO, '--title', title, '--body', body,
                 *[arg for label in labels for arg in ('--label', label)])
        number = int(url.rstrip('/').split('/')[-1])
        numbers[n] = number
        for blocker in node['blocked_by']:
            blocker_id = gh('api', f'repos/{REPO}/issues/{numbers[blocker]}', '--jq', '.id')
            gh('api', '-X', 'POST', f'repos/{REPO}/issues/{number}/dependencies/blocked_by',
               '-F', f'issue_id={blocker_id}')
        with open(NUMBERS, 'w') as f:
            json.dump(numbers, f, indent=2)
            f.write('\n')
        print(f'{n}: created #{number}')


if __name__ == '__main__':
    main()
