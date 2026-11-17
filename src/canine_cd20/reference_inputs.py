"""Rebuild reference-conditioned starting complexes using the study's frozen maps."""
from pathlib import Path
import csv
import gzip
import shutil
import gemmi
import numpy as np
from Bio.Align import PairwiseAligner, substitution_matrices
from .metrics import fit
from .project import contract, load_json, save_json


def residues(chain):
    return [r for r in chain if gemmi.find_tabulated_residue(r.name).is_amino_acid()]


def sequence(rows):
    return ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code.upper() for r in rows)


def align_map(reference, observed):
    tool = PairwiseAligner()
    tool.substitution_matrix = substitution_matrices.load('BLOSUM62')
    tool.open_gap_score = -10
    tool.extend_gap_score = -.5
    result = tool.align(reference, observed)[0]
    mapping = {}
    for a, b in zip(*result.aligned):
        for i, j in zip(range(*a), range(*b)):
            mapping[j] = i + 1
    return mapping


def ca(residue):
    atom = residue.find_atom('CA', '*')
    if not atom:
        raise ValueError('Missing C-alpha')
    return np.array([atom.pos.x, atom.pos.y, atom.pos.z])


def rebuild_inputs(root, output, reference=None):
    root, output = Path(root), Path(output)
    if output.exists():
        raise FileExistsError('Use a new output directory')
    output.mkdir(parents=True)
    roles = load_json(root / 'configs/reference_chains.json')
    ids = [reference] if reference else list(roles)
    human = ''.join(line.strip() for line in (root / 'data/inputs/human_cd20.fasta').read_text().splitlines() if not line.startswith('>'))
    dog_structure = gemmi.read_structure(str(root / 'data/inputs/dog_cd20_afdb.cif.gz'))
    dog_residues = {r.seqid.num: r for r in residues(dog_structure[0][0])}
    sample = contract(root, ids[0])
    dog_sequence = sample['full_target_sequence']
    human_to_dog = {value: key + 1 for key, value in align_map(human, dog_sequence).items()}
    summary = []
    for ident in ids:
        value = contract(root, ident)
        source = gemmi.read_structure(str(root / 'data/inputs/experimental' / (ident + '.cif.gz')))
        destination = output / ident
        destination.mkdir()
        prepared = gemmi.Structure()
        prepared.name = 'dog_cd20_' + ident
        prepared.add_model(gemmi.Model('1'))
        fits = []
        for role in ('A', 'B'):
            observed = residues(source[0][roles[ident][role]])
            mapping = align_map(human, sequence(observed))
            pairs = [(human_to_dog.get(mapping.get(j)), residue) for j, residue in enumerate(observed)]
            pairs = [(position, residue) for position, residue in pairs if position in value['target_core_dog_positions']]
            if len(pairs) < 140:
                raise ValueError('Insufficient observed target coverage: ' + ident)
            rmsd, rotation, shift = fit(np.array([ca(dog_residues[p]) for p, _ in pairs]), np.array([ca(r) for _, r in pairs]))
            chain = gemmi.Chain(role)
            for i, position in enumerate(value['target_core_dog_positions'], 1):
                clone = dog_residues[position].clone()
                clone.seqid = gemmi.SeqId(i, ' ')
                clone.label_seq = i
                clone.subchain = role
                clone.entity_id = '1'
                for atom in clone:
                    xyz = np.array([atom.pos.x, atom.pos.y, atom.pos.z]) @ rotation + shift
                    atom.pos = gemmi.Position(*xyz)
                chain.add_residue(clone)
            prepared[0].add_chain(chain)
            fits.append({'chain': role, 'matched_ca': len(pairs), 'rmsd_A': rmsd})
        for role in ('H', 'L'):
            observed = residues(source[0][roles[ident][role]])
            full = sequence(observed)
            parent = value['parent_sequences'][role]
            if full.count(parent) != 1:
                raise ValueError('Parent domain must match a unique observed sequence: ' + ident)
            start = full.index(parent)
            chain = gemmi.Chain(role)
            for i, residue in enumerate(observed[start:start + len(parent)], 1):
                clone = residue.clone()
                clone.seqid = gemmi.SeqId(i, ' ')
                clone.label_seq = i
                clone.subchain = role
                clone.entity_id = '2' if role == 'H' else '3'
                chain.add_residue(clone)
            prepared[0].add_chain(chain)
        prepared.setup_entities()
        prepared.assign_label_seq_id()
        prepared.make_mmcif_document().write_file(str(destination / 'starting_complex.cif'))
        for entity in prepared.entities:
            chain = next(c for c in prepared[0] if c.name in entity.subchains)
            entity.full_sequence = [residue.name for residue in residues(chain)]
        prepared.make_mmcif_document().write_file(str(destination / 'starting_complex_v2.cif'))
        save_json(destination / 'design_contract.json', value)
        for name in ('rfd4.yaml', 'boltzgen.yaml', 'scaffold_imgt_map.csv'):
            shutil.copyfile(root / 'data/inputs/references' / ident / name, destination / name)
        frozen = gemmi.read_structure(str(root / 'data/inputs/references' / ident / 'starting_complex.cif.gz'))
        rebuilt = gemmi.read_structure(str(destination / 'starting_complex.cif'))
        a = np.array([[atom.pos.x, atom.pos.y, atom.pos.z] for chain in rebuilt[0] for residue in chain for atom in residue])
        b = np.array([[atom.pos.x, atom.pos.y, atom.pos.z] for chain in frozen[0] for residue in chain for atom in residue])
        if a.shape != b.shape:
            raise ValueError('Rebuilt atom inventory differs: ' + ident)
        maximum = float(np.abs(a - b).max())
        if maximum > 1e-7:
            raise ValueError('Rebuilt coordinates differ: ' + ident + ' ' + str(maximum))
        summary.append({'reference_id': ident, 'maximum_coordinate_difference_A': maximum, 'homology_fits': fits})
    save_json(output / 'summary.json', summary)
    return summary
