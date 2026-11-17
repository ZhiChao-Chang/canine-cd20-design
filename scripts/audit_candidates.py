"""Check paired-chain identity and fixed frameworks without assuming binding success."""
from pathlib import Path
import argparse
import hashlib
import json
import gemmi

import os
ROOT = Path(os.environ['CD20_REFERENCE_ROOT'])
parser = argparse.ArgumentParser()
parser.add_argument('--pilot-only', action='store_true')
parser.add_argument('--output', default='pilot_candidates.json')
args = parser.parse_args()
contract = json.loads((ROOT / 'inputs/design_contract.json').read_text())
out = ROOT / 'results/candidates'
out.mkdir(exist_ok=True)
records = []
routes = [('rfd4', 'rfd4_pilot/inference_samples', '*generated.cif'),
          ('boltzgen', 'boltzgen_pilot/intermediate_designs_inverse_folded', '*.cif')]
if not args.pilot_only:
    routes += [('rfd4', 'rfd4_batch/inference_samples', '*generated.cif'),
               ('boltzgen', 'boltzgen_batch/intermediate_designs_inverse_folded', '*.cif')]
for route, directory, pattern in routes:
    files = sorted((ROOT / 'results' / directory).rglob(pattern))
    if args.pilot_only:
        assert files, (route, directory)
    for source in files:
        item = {'route': route, 'source': str(source), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
        structure = gemmi.read_structure(str(source))
        chains = []
        for chain in structure[0]:
            residues = [x for x in chain if gemmi.find_tabulated_residue(x.name).is_amino_acid()]
            sequence = ''.join(gemmi.find_tabulated_residue(x.name).one_letter_code.upper() for x in residues)
            if residues:
                chains.append((chain.name, residues, sequence))
        roles = {}
        for role in ('H', 'L'):
            parent = contract['parent_sequences'][role]
            design = set(contract['cdr_sequence_indices'][role])
            matched = [x for x in chains if len(x[2]) == len(parent) and all(aa == parent[i - 1] for i, aa in enumerate(x[2], 1) if i not in design)]
            if len(matched) == 1:
                roles[role] = matched[0]
        target = [x for x in chains if x[2] == contract['target_core_sequence']]
        valid = len(chains) == 4 and len(roles) == 2 and len(target) == 2
        item.update(phase='PASSED' if valid else 'NEEDS_ATTENTION', chain_lengths={x[0]: len(x[2]) for x in chains})
        if valid:
            roles.update(A=target[0], B=target[1])
            sequences = {role: roles[role][2] for role in ('H', 'L')}
            assert all(set(sequence) <= set('ACDEFGHIKLMNPQRSTVWY') for sequence in sequences.values())
            signature = hashlib.sha256((sequences['H'] + ':' + sequences['L']).encode()).hexdigest()[:16]
            candidate_id = route + '_' + signature
            changes = {role: [i for i, (a, b) in enumerate(zip(contract['parent_sequences'][role], sequence), 1) if a != b] for role, sequence in sequences.items()}
            assert all(set(changes[role]) <= set(contract['cdr_sequence_indices'][role]) for role in changes)
            normalized = gemmi.Structure()
            normalized.name = candidate_id
            normalized.add_model(gemmi.Model('1'))
            for role in ('A', 'B', 'H', 'L'):
                chain = gemmi.Chain(role)
                for index, residue in enumerate(roles[role][1], 1):
                    residue = residue.clone()
                    residue.seqid = gemmi.SeqId(index, ' ')
                    residue.label_seq = index
                    residue.subchain = role
                    chain.add_residue(residue)
                normalized[0].add_chain(chain)
            normalized.setup_entities()
            normalized.assign_label_seq_id()
            target_path = out / (candidate_id + '.cif')
            if not target_path.exists():
                normalized.make_mmcif_document().write_file(str(target_path))
            item.update(candidate_id=candidate_id, sequences=sequences, cdr_changed_indices=changes,
                mutation_count=sum(map(len, changes.values())), source_chain_map={role: roles[role][0] for role in roles},
                normalized_structure=str(target_path), framework_unchanged=True, paired_heavy_light=True,
                variant=bool(sum(map(len, changes.values()))))
        records.append(item)
(ROOT / 'reports' / args.output).write_text(json.dumps(records, indent=2) + '\n')
if args.pilot_only:
    assert len(records) >= 2 and all(x['phase'] == 'PASSED' and x['variant'] for x in records), records
print('CANDIDATE_CHAIN_AND_FRAMEWORK_AUDIT', len(records), sum(x['phase'] == 'PASSED' for x in records))
