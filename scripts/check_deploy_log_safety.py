"""Reject deployment steps that can print Google Cloud responses."""

import re
from pathlib import Path

WORKFLOW = Path(".github/workflows/mirror_checks_and_functions_deploy.yml")
RUN = re.compile(r"^(\s*)(-\s+)?run:\s*(.*?)\s*$")
TOOL = re.compile(r"""(?:^|[\s($])(?:[./\w-]+/)?(?:gcloud|gsutil|firebase(?:-tools)?)(?:[.]cmd|@[^\s]+)?(?=\s|$)""")
READ = re.compile(r"(?:^|\s)(?:describe|list|get-iam-policy|ls|cat)(?=\s|$)")
DEBUG = re.compile(r"(?:^|\s)(?:--debug(?:=[^\s]+)?|--verbosity(?:=|\s+)debug|--log-http)(?=\s|$)")
NULL = r"""['"]?/dev/null['"]?(?=\s|[)]|$)"""
STDOUT = re.compile(r"(?<![\w&>])(?:1)?>\s*" + NULL)
STDERR = re.compile(r"(?:^|\s)2>\s*" + NULL)
JOIN = re.compile(r"(?:^|\s)2>&1(?=\s|[)]|$)")
BOTH = re.compile(r"(?<![>&])&>\s*" + NULL)
SCRIPT = re.compile(r"(?:^|\s)bash\s+(scripts/[a-zA-Z0-9_./-]+\.sh)(?=\s|$)")


def workflow_runs(text):
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        match = RUN.fullmatch(lines[index])
        index += 1
        if not match:
            continue
        first_line = index
        value = match[3]
        if not value.startswith((">", "|")):
            yield first_line, value.strip("'\"") if value[:1] in ("'", '"') else value
            continue
        indent = len(match[1]) + len(match[2] or "")
        body = []
        while index < len(lines):
            line = lines[index]
            if line.strip() and len(line) - len(line.lstrip()) <= indent:
                break
            body.append(line)
            index += 1
        if value.startswith(">"):
            yield first_line + 1, " ".join(line.strip() for line in body)
        else:
            yield first_line + 1, "\n".join(body)


def shell_chunks(line):
    """Split adjacent shell commands so one cannot borrow another's redirect."""
    quote = ""
    escaped = False
    start = 0
    index = 0
    while index < len(line):
        char = line[index]
        if escaped:
            escaped = False
        elif char == "\\" and quote != "'":
            escaped = True
        elif quote:
            if char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
        elif char == "#" and (index == 0 or line[index - 1].isspace()):
            break
        elif char in ";|" or line.startswith("&&", index):
            yield line[start:index]
            while index + 1 < len(line) and line[index + 1] == char and char in "&|":
                index += 1
            start = index + 1
        elif char == "&" and (index == 0 or line[index - 1] not in "><") and not line.startswith("&>", index):
            yield line[start:index]
            start = index + 1
        index += 1
    yield line[start:index]


QUOTED = re.compile(r"'[^']*'|\"(?:[^\"\\]|\\.)*\"")


def visible_redirections(command):
    return QUOTED.sub(
        lambda m: " /dev/null " if m[0][1:-1] == "/dev/null" else " " * len(m[0]),
        command,
    )


def discarded(command):
    command = visible_redirections(command)
    out = STDOUT.search(command)
    err = STDERR.search(command)
    join = JOIN.search(command)
    return bool(BOTH.search(command) or (out and (err or (join and join.start() > out.end() - 1))))


def findings(text, first_line=1):
    logical = []
    pending = ""
    for number, line in enumerate(text.splitlines(), first_line):
        if not pending:
            start = number
        if line.rstrip().endswith("\\"):
            pending += line.rstrip()[:-1] + " "
            continue
        logical.append((start, pending + line))
        pending = ""
    if pending:
        logical.append((start, pending))

    groups = []
    quiet = set()
    for index, (_, line) in enumerate(logical):
        bare = line.strip()
        if bare in ("(", "{"):
            groups.append((index, ")" if bare == "(" else "}"))
        elif re.match(r"^[)}](?:\s|[&>]|$)", bare) and groups:
            opening, end = groups.pop()
            if bare.startswith(end) and discarded(bare) and len(list(shell_chunks(bare))) == 1:
                quiet.update(range(opening + 1, index))

    for index, (number, line) in enumerate(logical):
        if index in quiet:
            continue
        for command in shell_chunks(line):
            tool = TOOL.search(command)
            if not tool:
                continue
            args = command[tool.end():]
            if not (READ.search(args) or DEBUG.search(args)):
                continue
            # A bare assignment captures stdout. Reject output substitutions
            # within other commands because those can print the captured value.
            captured = (
                re.match(r'\s*[A-Za-z_]\w*=["\']?\$\(', command)
                and re.search(r'\)["\']?\s*$', command)
                and STDERR.search(visible_redirections(command[command.index("$(") + 2 : command.rindex(")")]))
            )
            if not (discarded(command) or captured):
                yield number


def main():
    failures = set()
    scripts = set()
    for first_line, step in workflow_runs(WORKFLOW.read_text(encoding="utf-8")):
        failures.update((WORKFLOW, line) for line in findings(step, first_line))
        scripts.update(Path(match[1]) for match in SCRIPT.finditer(step))
    for script in scripts:
        failures.update((script, line) for line in findings(script.read_text(encoding="utf-8")))
    for path, line in sorted(failures):
        print(f"::error file={path.as_posix()},line={line}::Comando de nuvem sem protecao de stdout e stderr.")
    if not failures:
        print("Saida do workflow de deploy verificada.")
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
