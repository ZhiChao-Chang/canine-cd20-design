"""Portable project inputs and completed-study data."""
from pathlib import Path
import csv
import json
import re


def project_root(value=None):
    if value is not None:
        root = Path(value).resolve()
    else:
        candidates = [Path.cwd(), *Path(__file__).resolve().parents]
        root = next((p for p in candidates if (p / 'configs/study.json').is_file()), None)
        if root is None:
            raise FileNotFoundError('Run from the project checkout or pass --root PATH')
    if not (root / 'configs/study.json').is_file():
        raise FileNotFoundError('Missing configs/study.json: ' + str(root))
    return root


def load_json(path):
    return json.loads(Path(path).read_text())


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def scalar(value):
    if value == '':
        return None
    if value in ('True', 'true'):
        return True
    if value in ('False', 'false'):
        return False
    if value[:1] in ('[', '{'):
        return json.loads(value)
    if re.fullmatch(r'-?\d+', value):
        return int(value)
    if re.fullmatch(r'-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', value):
        return float(value)
    return value


def read_table(path):
    with Path(path).open(newline='') as handle:
        return [{key: scalar(value) for key, value in row.items()} for row in csv.DictReader(handle)]


def write_table(path, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(dict.fromkeys(k for row in rows for k in row))
    with path.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items()})


def contract(root, reference):
    value = load_json(Path(root) / 'data/inputs/references' / reference / 'design_contract.json')
    if value['reference_id'] != reference:
        raise ValueError('Reference contract identity mismatch')
    return value


def validate_pair(value, reference_contract):
    """Validate the frozen parent masks; do not reannotate a generated sequence."""
    for role, field in [('H', 'heavy_sequence'), ('L', 'light_sequence')]:
        sequence = value[field]
        parent = reference_contract['parent_sequences'][role]
        allowed = set(reference_contract['cdr_sequence_indices'][role])
        if len(sequence) != len(parent) or set(sequence) - set('ACDEFGHIKLMNPQRSTVWY'):
            raise ValueError('Invalid paired variable-domain sequence: ' + value['case_id'])
        if any(a != b and i not in allowed for i, (a, b) in enumerate(zip(sequence, parent), 1)):
            raise ValueError('Framework mutation outside frozen mask: ' + value['case_id'])
    return ''.join(value[field][i - 1] for role, field in [('H', 'heavy_sequence'), ('L', 'light_sequence')]
                   for i in reference_contract['cdr_sequence_indices'][role])
