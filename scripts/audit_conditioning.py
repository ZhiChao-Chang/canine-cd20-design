from pathlib import Path
import json
import gemmi

import os
ROOT = Path(os.environ['CD20_REFERENCE_ROOT'])
contract = json.loads((ROOT / 'inputs/design_contract.json').read_text())
files = list((ROOT / 'results/rfd4_input').glob('*.cif'))
assert len(files) == 1
block = gemmi.cif.read_file(str(files[0])).sole_block()
table = block.find_mmcif_category('_atom_site.')
tags = list(table.tags)
required = ['_atom_site.auth_asym_id', '_atom_site.label_seq_id', '_atom_site.label_atom_id',
            '_atom_site.condition_sequence_1_residue', '_atom_site.condition_CoordinateGroup_1_atom']
indices = [tags.index(x) for x in required]
seen = {}
for row in table:
    chain, number, atom, conditioned, group = [row[x] for x in indices]
    if atom != 'CA':
        continue
    index = int(number)
    if chain in ('A', 'B'):
        assert conditioned not in ('MASKED', '<M>') and int(group) == 1, (chain, number, conditioned, group)
    elif chain in ('H', 'L'):
        cdr = index in contract['cdr_sequence_indices'][chain]
        assert (conditioned in ('MASKED', '<M>')) == cdr, (chain, number, conditioned, cdr)
        assert int(group) == (-1 if cdr else 2), (chain, number, group, cdr)
    else:
        raise AssertionError(('Unexpected chain', chain))
    seen.setdefault(chain, []).append(index)
assert set(seen) == {'A', 'B', 'H', 'L'}
for chain, values in seen.items():
    expected = len(contract['target_core_sequence']) if chain in ('A', 'B') else len(contract['parent_sequences'][chain])
    assert sorted(values) == list(range(1, expected + 1)), (chain, len(values), expected)
(ROOT / 'reports/conditioning_audit_v2.json').write_text(json.dumps({'phase': 'PASSED',
    'paired_heavy_light_preserved': True, 'framework_sequences_fixed': True,
    'six_cdrs_unconditioned': True, 'shared_hl_framework_coordinate_group': 2,
    'target_dimer_coordinate_group': 1, 'chain_lengths': {k: len(v) for k, v in seen.items()}}, indent=2) + '\n')
print('PAIRED_FV_CONDITIONING_AUDIT_PASSED')
