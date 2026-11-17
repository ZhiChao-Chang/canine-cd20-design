"""Structural metrics used by the completed CD20 study. Coordinates are in angstroms."""
from itertools import permutations
import json
import csv
import math
import numpy as np
import gemmi

AA=set('ACDEFGHIKLMNPQRSTVWY')

def read_chains(path, expected=None):
    structure = gemmi.read_structure(str(path))
    assert len(structure) == 1
    out = {}
    for chain in structure[0]:
        residues = [r for r in chain if gemmi.find_tabulated_residue(r.name).is_amino_acid()]
        if not residues:
            continue
        seq = ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code.upper() for r in residues)
        assert set(seq) <= AA and chain.name not in out
        ca, atoms, atom_res, b_ca = [], [], [], []
        for i, res in enumerate(residues, 1):
            # This workflow has no missing residues; enforce the label map.
            assert (res.label_seq or res.seqid.num) == i, (path, chain.name, i)
            c = res.find_atom('CA', '*')
            assert c
            ca.append([c.pos.x, c.pos.y, c.pos.z])
            b_ca.append(c.b_iso)
            for atom in res:
                if atom.element.name in ('H', 'D') or atom.occ <= 0:
                    continue
                atoms.append([atom.pos.x, atom.pos.y, atom.pos.z])
                atom_res.append(i)
        out[chain.name] = dict(sequence=seq, ca=np.array(ca), xyz=np.array(atoms),
                               residue_index=np.array(atom_res), ca_b=np.array(b_ca))
        assert np.isfinite(out[chain.name]['xyz']).all()
    if expected is not None:
        assert set(out) == set(expected), (path, list(out), list(expected))
        assert all(out[k]['sequence'] == v for k, v in expected.items()), str(path)
    return out

def fit(mobile, reference):
    """Row-vector Kabsch, proper rotation, including translated coordinates."""
    assert mobile.shape == reference.shape and mobile.shape[1] == 3
    a, b = mobile.mean(0), reference.mean(0)
    u, _, vt = np.linalg.svd((mobile-a).T @ (reference-b))
    d = np.eye(3)
    d[-1, -1] = np.linalg.det(u @ vt)
    rot = u @ d @ vt
    shift = b - a @ rot
    rmsd = float(np.sqrt(np.mean(np.sum((mobile @ rot + shift - reference)**2, axis=1))))
    return rmsd, rot, shift

def contact(a, b, cutoff):
    """Heavy-atom pairs with bounded memory; return minimum and atom pairs."""
    left, right, closest = [], [], math.inf
    for start in range(0, len(a), 128):
        dist2 = np.sum((a[start:start+128, None, :] - b[None, :, :])**2, axis=-1)
        closest = min(closest, float(dist2.min()))
        i, j = np.where(dist2 < cutoff**2)
        left.extend((i + start).tolist())
        right.extend(j.tolist())
    return float(np.sqrt(closest)), np.array(left, dtype=int), np.array(right, dtype=int)

def native_scores(path, model):
    d = json.loads(path.read_text())
    matrix = d.get('chain_pair_iptm', d.get('pair_chains_iptm'))
    if matrix is not None:
        if isinstance(matrix, dict):
            matrix = [[matrix[str(i)][str(j)] for j in range(4)] for i in range(4)]
        matrix = np.asarray(matrix, dtype=float)
        assert matrix.shape == (4, 4) and np.isfinite(matrix).all()
        ids = d.get('chain_ids', ['A', 'B', 'H', 'L'])
        assert ids == ['A', 'B', 'H', 'L']
        values = [matrix[i, j] for i in (0, 1) for j in (2, 3)]
        values += [matrix[j, i] for i in (0, 1) for j in (2, 3)]
        interface = float(np.mean(values))
        fallback = False
    else:
        interface, fallback = float(d['iptm']), True
    assert 0 <= interface <= 1
    return dict(interface_iptm=interface, interface_score_fallback=fallback,
                global_iptm=float(d['iptm']), ptm=float(d['ptm']))

def geometry(chains, contract):
    ext = set(contract['extracellular_core_indices'])
    cdr = {k: set(v) for k, v in contract['cdr_sequence_indices'].items()}
    contacts, all_contacts, clashes = [], [], []
    mins = []
    for antigen in ('A', 'B'):
        a = chains[antigen]
        for binder in ('H', 'L'):
            b = chains[binder]
            distance, i, j = contact(a['xyz'], b['xyz'], 4.5)
            mins.append(distance)
            residue_pairs = sorted(set(zip(a['residue_index'][i].tolist(), b['residue_index'][j].tolist())))
            all_contacts.extend([[antigen, x, binder, y] for x, y in residue_pairs])
            contacts.extend([[antigen, x, binder, y] for x, y in residue_pairs if x in ext and y in cdr[binder]])
            _, ci, _ = contact(a['xyz'], b['xyz'], 1.5)
            clashes.append(len(ci))
    _, dimer, _ = contact(chains['A']['xyz'], chains['B']['xyz'], 1.5)
    _, hl, _ = contact(chains['H']['xyz'], chains['L']['xyz'], 1.5)
    return dict(extracellular_cdr_contact_support=bool(contacts),
                extracellular_cdr_residue_pairs=len(contacts), extracellular_cdr_contacts=contacts,
                antigen_fv_residue_pairs=len(all_contacts), minimum_antigen_fv_distance_A=min(mins),
                antigen_fv_clash_atom_pairs=sum(clashes), antigen_dimer_clash_atom_pairs=len(dimer),
                heavy_light_clash_atom_pairs=len(hl))

def pose(a, b):
    """Fit the receptor dimer, consider both identical-subunit assignments."""
    candidates = []
    for perm in permutations(('A', 'B')):
        mobile = np.concatenate([a[k]['ca'] for k in perm])
        ref = np.concatenate([b[k]['ca'] for k in ('A', 'B')])
        rmsd, rotation, shift = fit(mobile, ref)
        ac = np.concatenate([a[k]['ca'] for k in ('H', 'L')])
        bc = np.concatenate([b[k]['ca'] for k in ('H', 'L')])
        binder = float(np.sqrt(np.mean(np.sum((ac @ rotation + shift - bc)**2, axis=1))))
        candidates.append((rmsd, binder, ''.join(perm), rotation, shift))
    # Identical antigen subunits have no intrinsic A/B identity. Each permutation
    # gets its own antigen-only fit; compare the equivalent binder placements.
    # Keep antigen-fit quality visible rather than assigning a false chain identity
    # from tiny (e.g. 0.001 A) differences between nearly symmetric receptor fits.
    best = min(candidates, key=lambda x: (x[1], x[0], x[2]))
    fv_fit = fit(np.concatenate([a[k]['ca'] for k in ('H', 'L')]),
                 np.concatenate([b[k]['ca'] for k in ('H', 'L')]))[0]
    return dict(antigen_fit_ca_rmsd_A=best[0], fv_pose_ca_rmsd_A=best[1],
                antigen_chain_permutation=best[2], fv_self_fit_ca_rmsd_A=fv_fit,
                minimum_antigen_fit_over_permutations_A=min(x[0] for x in candidates),
                fv_pose_rmsd_by_permutation_A={x[2]:x[1] for x in candidates}), best[3], best[4]

def percentiles(values):
    """Average tied rank, endpoints (rank-1)/(n-1); all-tied -> 0.5."""
    a = np.array(values, dtype=float)
    if len(a) == 1:
        return [0.5]
    return [float((np.sum(a < x) + (np.sum(a == x) - 1)/2)/(len(a)-1)) for x in a]


def table(path, rows):
    assert rows
    fields = list(dict.fromkeys(k for row in rows for k in row))
    with path.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in rows:
            w.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v for k, v in row.items()})
