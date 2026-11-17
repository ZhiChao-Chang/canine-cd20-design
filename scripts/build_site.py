"""Build the project-results page from checked-in data and React source."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'index.html')
    parser.add_argument('--skip-build', action='store_true', help='Package an already-built web/dist/index.html')
    args = parser.parse_args()
    snapshot_path = ROOT / 'web/src/data.json'
    snapshot = json.loads(snapshot_path.read_text())
    for name, query in snapshot['queries'].items():
        source = ROOT / 'data/results/display_queries' / (name + '.json')
        rows = json.loads(source.read_text())
        query['rows'] = rows
        query['source']['files'] = [{'name': str(source.relative_to(ROOT)), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}]
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    if not args.skip_build:
        subprocess.run(['npm', '--prefix', str(ROOT / 'web'), 'run', 'build'], check=True)
    source = ROOT / 'web/dist/index.html'
    if not source.is_file():
        raise FileNotFoundError('Build the frontend before packaging')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, args.output)
    print('Built project results page: ' + str(args.output))


if __name__ == '__main__':
    main()
