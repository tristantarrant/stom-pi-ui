#!/bin/sh
# Dev launcher for mod-ui from a source checkout (TCP HMI transport enabled).
# If ./modui-env is missing it creates the venv and installs requirements.txt,
# applying the compatibility patches that pinned tornado==4.3 needs on modern
# Pythons: removed collections ABCs (>= 3.10) and ssl.match_hostname (>= 3.12).
DIR=$(dirname $0)
cd "$DIR" || exit 1

VENV=modui-env
if [ ! -x "$VENV/bin/python" ]; then
    echo ">> creating dev venv '$VENV' (needs python3-venv; aggdraw needs zlib/jpeg headers, e.g. apt install libjpeg62-turbo-dev zlib1g-dev)" >&2
    python3 -m venv "$VENV" || exit 1

    echo ">> installing requirements.txt into $VENV" >&2
    "$VENV/bin/pip" install --disable-pip-version-check --no-cache-dir \
        -r requirements.txt || exit 1

    # tornado==4.3 predates Python 3.10: rewrite removed 'collections' ABC usages
    # in the installed packages (idempotent; same logic as debian/scripts/tornado-abc-fix.py).
    echo ">> patching removed 'collections' ABC imports/usages in $VENV" >&2
    "$VENV/bin/python" <<'PYEOF' || exit 1
import os, re, site

SITE = site.getsitepackages()[0]

ABC_NAMES = (
    'MutableMapping', 'Mapping', 'MutableSequence', 'Sequence', 'MutableSet',
    'Set', 'Iterable', 'Iterator', 'Callable', 'Hashable', 'Container',
)

MARKER = '# tornado-abc-fix'

FROM_IMP = re.compile(r'^from collections import ([A-Za-z_][A-Za-z0-9_, \t]*)$', re.M)
BARE_IMP_LINE = re.compile(r'^import collections[^\S\n]*\n', re.M)  # column-0 only (module level)
ATTR_USE = re.compile(r'\bcollections\.(' + '|'.join(ABC_NAMES) + r')\b')

SHIM = (
    'try:  %s shim: ABCs moved out of "collections" in Python >= 3.10\n'
    '    from collections import abc as _tornado_abc_fix_abcm\n'
    'except ImportError:\n'
    '    pass\n'
    'else:\n'
    '    for _tornado_abc_fix_name in %s:\n'
    '        if not hasattr(collections, _tornado_abc_fix_name):\n'
    '            setattr(collections, _tornado_abc_fix_name,\n'
    '                    getattr(_tornado_abc_fix_abcm, _tornado_abc_fix_name))\n' % (MARKER, repr(list(ABC_NAMES)))
)


def fix_from_import(match):
    names = [n.strip() for n in match.group(1).split(',') if n.strip()]
    # Leave non-ABC imports (OrderedDict, defaultdict, ...) untouched.
    if not all(n in ABC_NAMES for n in names):
        return match.group(0)
    joined = ', '.join(names)
    return ('try:\n'
            'from collections.abc import %s\n' % joined +
            'except ImportError:\n'
            'from collections import %s' % joined)


patched = 0
for root, dirs, files in os.walk(SITE):
    dirs[:] = [d for d in dirs if d != '__pycache__']
    for name in files:
        if not name.endswith('.py'):
            continue
        path = os.path.join(root, name)
        with open(path, encoding='utf-8') as fh:
            src = fh.read()

        new = FROM_IMP.sub(fix_from_import, src)

        # Pattern B: attribute access on a bare module-level `import collections`.
        if (MARKER not in new and ATTR_USE.search(new)):
            m = BARE_IMP_LINE.search(new)
            if m is None:
                print('WARNING: %s uses removed ABC attributes but has no '
                      'module-level "import collections" anchor; skipped' % os.path.relpath(path, SITE))
            else:
                pos = m.end()  # just after the import line's newline -> shim starts on its own line
                new = new[:pos] + SHIM + new[pos:]

        if new != src:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(new)
            patched += 1
            print('patched %s' % os.path.relpath(path, SITE))

print('tornado-abc-fix: rewrote ABC imports in %d file(s)' % patched)
PYEOF

    # Python >= 3.12 removed ssl.match_hostname; tornado <5 falls back to the PyPI
    # backport at import time (tornado/netutil.py). Install it only when needed.
    if ! "$VENV/bin/python" -c "import ssl, sys; sys.exit(0 if hasattr(ssl, 'match_hostname') else 1)"; then
        echo ">> installing backports.ssl-match-hostname (required by tornado <5 on Python >= 3.12)" >&2
        "$VENV/bin/pip" install --disable-pip-version-check --no-cache-dir \
            backports.ssl-match-hostname || exit 1
    fi
fi

export MOD_DATA_DIR=$HOME/.local/share/mod-data
export MOD_USER_FILES_DIR="$MOD_DATA_DIR/user-files"
mkdir -p "$MOD_USER_FILES_DIR"
mkdir -p "$MOD_USER_FILES_DIR/Audio Loops"
mkdir -p "$MOD_USER_FILES_DIR/Audio Recordings"
mkdir -p "$MOD_USER_FILES_DIR/Audio Samples"
mkdir -p "$MOD_USER_FILES_DIR/Audio Tracks"
mkdir -p "$MOD_USER_FILES_DIR/Speaker Cabinets IRs"
mkdir -p "$MOD_USER_FILES_DIR/Hydrogen Drumkits"
mkdir -p "$MOD_USER_FILES_DIR/Reverb IRs"
mkdir -p "$MOD_USER_FILES_DIR/MIDI Clips"
mkdir -p "$MOD_USER_FILES_DIR/MIDI Songs"
mkdir -p "$MOD_USER_FILES_DIR/SF2 Instruments"
mkdir -p "$MOD_USER_FILES_DIR/SFZ Instruments"
mkdir -p "$MOD_USER_FILES_DIR/Aida DSP Models"
mkdir -p "$MOD_USER_FILES_DIR/NAM Models"
mkdir -p "$MOD_USER_FILES_DIR/Easy Spin Programs"
export MOD_USER_PEDALBOARDS_DIR="$MOD_DATA_DIR/pedalboards"
mkdir -p "$MOD_USER_PEDALBOARDS_DIR"
export MOD_DEV_ENVIRONMENT=0
export MOD_HMI_TRANSPORT=tcp
export MOD_HMI_TCP_PORT=9898
# Override the system-wide PIPEWIRE_QUANTUM (1024/48000 from /etc/profile.d) for
# everything this script starts: mod-host and the UI's own jack client
# (utils/libmod_utils.so loaded via ctypes in modtools/utils.py).
export PIPEWIRE_QUANTUM=128/48000
export PIPEWIRE_LATENCY=128/48000
. "$VENV"/bin/activate

# Ensure mod-host is running before starting the webserver; if this script had
# to start it, terminate that instance when we exit.
MOD_HOST_PID=""
if ! pgrep -x mod-host >/dev/null 2>&1; then
    echo ">> starting mod-host" >&2
    mod-host -n -p 5555 -f 5556 &
    MOD_HOST_PID=$!
fi

cleanup() { [ -n "$MOD_HOST_PID" ] && kill "$MOD_HOST_PID" 2>/dev/null || : ; }
trap cleanup EXIT INT TERM HUP
python server.py
