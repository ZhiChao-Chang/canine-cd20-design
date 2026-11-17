"""Reference, target-region, CDR, generation-pose and contact-footprint diagnostics."""
from pathlib import Path
from itertools import permutations
import gemmi
import numpy as np
from . import metrics as M
from .analysis import Coordinates
from .project import contract, load_json, read_table, save_json, write_table
TM=[(52,72),(76,96),(123,143),(189,209)]
ECD=[(73,75),(144,188)]

def inside(position, spans):
    return any(a <= position <= b for a, b in spans)

def read_ca(path, expected=None):
    structure = gemmi.read_structure(str(path))
    assert len(structure) == 1
    chains = {}
    for chain in structure[0]:
        residues = [r for r in chain if gemmi.find_tabulated_residue(r.name).is_amino_acid()]
        if not residues:
            continue
        sequence = ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code.upper() for r in residues)
        atoms = [r.find_atom('CA', '*') for r in residues]
        assert all(atoms), (path, chain.name)
        chains[chain.name] = {
            'sequence': sequence,
            'ca': np.array([[a.pos.x, a.pos.y, a.pos.z] for a in atoms]),
            'b': np.array([a.b_iso for a in atoms]),
        }
    if expected is not None:
        assert set(chains) == set(expected)
        assert all(chains[key]['sequence'] == sequence for key, sequence in expected.items()), path
    return chains

def rmsd(a, b):
    return float(np.sqrt(np.mean(np.sum((a - b) ** 2, axis=1))))

def flatten(chains, names):
    return np.concatenate([chains[name]['ca'] for name in names])

def pair_diagnostics(a, b, positions):
    """Retain the frozen symmetry convention; vary the fitting region separately.

    The decomposition is algebraic within the chosen CD20 coordinate frame.
    It does not attribute a causal fraction of disagreement to CD20 prediction.
    """
    baseline, rotation, shift = M.pose(a, b)
    order = list(baseline['antigen_chain_permutation'])
    fa, fb = flatten(a, ('H', 'L')), flatten(b, ('H', 'L'))
    transformed = fa @ rotation + shift
    translation_sq = float(np.sum((transformed.mean(0) - fb.mean(0)) ** 2))
    centered_sq = float(np.mean(np.sum(((transformed - transformed.mean(0)) - (fb - fb.mean(0))) ** 2, axis=1)))
    shape = M.fit(fa, fb)[0]
    orientation_sq = centered_sq - shape ** 2
    assert orientation_sq > -1e-7
    orientation_sq = max(0., orientation_sq)
    assert abs(baseline['fv_pose_ca_rmsd_A'] ** 2 - translation_sq - orientation_sq - shape ** 2) < 1e-6
    row = {key: value for key, value in baseline.items() if key != 'fv_pose_rmsd_by_permutation_A'}
    row.update(fv_centroid_displacement_A=float(np.sqrt(translation_sq)),
               fv_translation_mse_A2=translation_sq,
               fv_orientation_mse_A2=orientation_sq,
               fv_shape_mse_A2=shape ** 2,
               decomposition_error_A2=baseline['fv_pose_ca_rmsd_A'] ** 2 - translation_sq - orientation_sq - shape ** 2)
    monomer = [M.fit(a[left]['ca'], b[right]['ca'])[0] for left, right in zip(order, ('A', 'B'))]
    row['antigen_monomer_self_fit_median_A'] = float(np.median(monomer))
    row['matched_antigen_ca'] = 2 * len(positions)
    row['matched_fv_ca'] = len(fa)
    for name, spans in [('tm', TM), ('ecd', ECD)]:
        indices = np.array([i for i, position in enumerate(positions) if inside(position, spans)])
        mobile = np.concatenate([a[key]['ca'][indices] for key in order])
        target = np.concatenate([b[key]['ca'][indices] for key in ('A', 'B')])
        region_rmsd, rr, tt = M.fit(mobile, target)
        alternate_fv = fa @ rr + tt
        row[name + '_matched_antigen_ca'] = len(mobile)
        row[name + '_antigen_fit_rmsd_A'] = region_rmsd
        row[name + '_anchored_fv_rmsd_A'] = rmsd(alternate_fv, fb)
        row[name + '_frame_change_fv_rmsd_A'] = rmsd(alternate_fv, transformed)
    row['ecd_vs_core_pose_absolute_change_A'] = abs(row['ecd_anchored_fv_rmsd_A'] - row['fv_pose_ca_rmsd_A'])
    return row

def numerical_checks():
    rng = np.random.default_rng(20261113)
    base = {key: {'ca': rng.normal(size=(size, 3)) + offset}
            for key, size, offset in [('A', 165, 0), ('B', 165, 12), ('H', 100, 30), ('L', 90, 38)]}
    angle = .37
    rot = np.array([[np.cos(angle), -np.sin(angle), 0], [np.sin(angle), np.cos(angle), 0], [0, 0, 1]])
    moved = {key: {'ca': value['ca'] @ rot + [12, -4, 7]} for key, value in base.items()}
    positions = list(range(46, 211))
    assert pair_diagnostics(moved, base, positions)['fv_pose_ca_rmsd_A'] < 1e-10
    shifted = {key: {'ca': value['ca'].copy()} for key, value in base.items()}
    for key in ['H', 'L']:
        shifted[key]['ca'] += [3, 4, 0]
    result = pair_diagnostics(shifted, base, positions)
    assert abs(result['fv_pose_ca_rmsd_A'] - 5) < 1e-9
    assert abs(result['fv_translation_mse_A2'] - 25) < 1e-9
    assert result['fv_orientation_mse_A2'] < 1e-9 and result['fv_shape_mse_A2'] < 1e-9
    spun = {key: {'ca': value['ca'].copy()} for key, value in base.items()}
    center = flatten(base, ('H', 'L')).mean(0)
    for key in ['H', 'L']:
        spun[key]['ca'] = (spun[key]['ca'] - center) @ rot + center
    result = pair_diagnostics(spun, base, positions)
    assert result['fv_translation_mse_A2'] < 1e-9 and result['fv_shape_mse_A2'] < 1e-9
    assert result['fv_orientation_mse_A2'] > .01
    swapped = dict(base, A=base['B'], B=base['A'])
    assert pair_diagnostics(swapped, base, positions)['fv_pose_ca_rmsd_A'] < 1e-10
    return ['global rigid-motion invariance', 'known 5-A Fv translation', 'centroid-fixed Fv rotation', 'CD20 subunit-label exchange']


def human_metrics(chains, geometry):
    possibilities=[]
    for order in permutations(('A','B')):
        mobile=np.concatenate([chains[left]['ca'][np.array(geometry['antigen'][right]['core_indices'])-1]for left,right in zip(order,('A','B'))])
        target=np.concatenate([np.array(geometry['antigen'][right]['xyz'])for right in ('A','B')])
        error,rotation,shift=M.fit(mobile,target)
        possibilities.append((error,''.join(order),rotation,shift))
    error,order,rotation,shift=min(possibilities,key=lambda value:(value[0],value[1]))
    fv=flatten(chains,('H','L'))
    ref_fv=np.concatenate([np.array(geometry['antibody'][key])for key in ('H','L')])
    regional={}
    for name,spans in [('core',[(46,210)]),('tm',TM),('ecd',ECD)]:
        moved_parts,reference_parts=[],[]
        for left,right in zip(order,('A','B')):
            core_indices=geometry['antigen'][right]['core_indices']
            select=[j for j,index in enumerate(core_indices)if inside(index+45,spans)]
            source_indices=np.array([core_indices[j]-1 for j in select])
            moved_parts.append(chains[left]['ca'][source_indices])
            reference_parts.append(np.array(geometry['antigen'][right]['xyz'])[select])
        aa,bb=np.concatenate(moved_parts),np.concatenate(reference_parts)
        regional[name+'_ca_count']=len(aa)
        regional[name+'_residual_in_core_frame_A']=rmsd(aa@rotation+shift,bb)
        regional[name+'_self_fit_rmsd_A']=M.fit(aa,bb)[0]
    return {'human_reference_antigen_fit_A':error,'human_reference_fv_pose_A':rmsd(fv@rotation+shift,ref_fv),
            'human_reference_fv_self_fit_A':M.fit(fv,ref_fv)[0],'antigen_only_chain_permutation':order,
            'antigen_only_permutation_convention':'minimum antigen RMSD, unlike frozen pose-optimal equivalent-subunit convention',**regional}


def experimental_footprint(root, reference):
    value=contract(root,reference)
    geometry=load_json(Path(root)/'data/inputs/references'/reference/'reference_geometry.json')
    roles=load_json(Path(root)/'configs/reference_chains.json')[reference]
    structure=gemmi.read_structure(str(Path(root)/'data/inputs/experimental'/(reference+'.cif.gz')))
    def residues(chain):return[r for r in chain if gemmi.find_tabulated_residue(r.name).is_amino_acid()]
    def atoms(residue):return[[a.pos.x,a.pos.y,a.pos.z]for a in residue if a.element.name not in ('H','D')and a.occ>0]
    binder=[]
    for role in ('H','L'):
        observed=residues(structure[0][roles[role]])
        sequence=''.join(gemmi.find_tabulated_residue(r.name).one_letter_code.upper()for r in observed)
        start=sequence.index(value['parent_sequences'][role])
        for index in value['cdr_sequence_indices'][role]:binder.extend(atoms(observed[start+index-1]))
    binder=np.array(binder);positions=set();checked=0
    for role in ('A','B'):
        points=np.array(geometry['antigen'][role]['xyz']);indices=geometry['antigen'][role]['core_indices']
        for residue in residues(structure[0][roles[role]]):
            ca=residue.find_atom('CA','*')
            if not ca:continue
            distances=np.linalg.norm(points-[ca.pos.x,ca.pos.y,ca.pos.z],axis=1);nearest=int(distances.argmin())
            if distances[nearest]>1e-5:continue
            position=indices[nearest]+45
            if not inside(position,ECD):continue
            checked+=1
            if M.contact(np.array(atoms(residue)),binder,4.5)[0]<4.5:positions.add(position)
    if not checked or not positions:raise ValueError('No observed experimental footprint: '+reference)
    return sorted(positions),checked


def reproduce_diagnostics(root, output):
    root,output=Path(root),Path(output)
    if output.exists():raise FileExistsError('Use a new output directory')
    output.mkdir(parents=True)
    coordinates=Coordinates(root)
    cases={row['case_id']:row for row in load_json(root/'data/inputs/cases.json')}
    contracts={rid:contract(root,rid)for rid in load_json(root/'configs/study.json')['reference_ids']}
    geometries={rid:load_json(root/'data/inputs/references'/rid/'reference_geometry.json')for rid in contracts}
    definitions=root/'data/results/display_queries';maximum={};counts={}
    def checked_export(name,rows):
        expected=load_json(definitions/(name+'.json'))
        if len(rows)!=len(expected):raise ValueError('Unexpected diagnostic count: '+name)
        error=0.
        for actual,reference in zip(rows,expected):
            for key,value in reference.items():
                current=actual.get(key)
                if isinstance(value,(int,float))and not isinstance(value,bool):
                    error=max(error,abs(float(current)-float(value)))
                elif current!=value:raise ValueError('Diagnostic mismatch: '+str((name,key,current,value)))
        if error>1e-7:raise ValueError('Numerical diagnostic mismatch: '+str((name,error)))
        maximum[name]=error;counts[name]=len(rows);write_table(output/(name+'.csv'),rows)
    rows=[]
    for row in load_json(definitions/'poseDiagnostics.json'):
        a=coordinates.chains(row['case_id'],row['model_a'],row['seed_a']);b=coordinates.chains(row['case_id'],row['model_b'],row['seed_b'])
        rows.append({**row,**pair_diagnostics(a,b,contracts[row['reference_id']]['target_core_dog_positions'])})
    checked_export('poseDiagnostics',rows)
    checked_export('humanDiagnostics',[{**row,**human_metrics(coordinates.chains(row['case_id'],row['model'],row['seed']),geometries[row['reference_id']])}for row in load_json(definitions/'humanDiagnostics.json')])
    designs={r['case_id']:r for r in load_json(root/'data/designs/index.json')};design_coordinates={key:read_ca(root/value['file'],cases[key]['chains'])for key,value in designs.items()}
    rows=[]
    for row in load_json(definitions/'generatorComparison.json'):
        value,_,_=M.pose(coordinates.chains(row['case_id'],row['model'],42),design_coordinates[row['case_id']]);value.pop('fv_pose_rmsd_by_permutation_A');rows.append({**row,**value})
    checked_export('generatorComparison',rows)
    rows=[]
    for row in load_json(definitions/'cdrDiagnostics.json'):
        value=contracts[row['reference_id']];length=len(value['parent_sequences']['H']);total=length+len(value['parent_sequences']['L'])
        mask=np.array([i-1 for i in value['cdr_sequence_indices']['H']]+[length+i-1 for i in value['cdr_sequence_indices']['L']]);framework=np.array([i for i in range(total)if i not in mask])
        a=flatten(coordinates.chains(row['case_id'],row['model_a'],42),('H','L'));b=flatten(coordinates.chains(row['case_id'],row['model_b'],42),('H','L'));error,rotation,shift=M.fit(a[framework],b[framework])
        rows.append({**row,'cdr_positions':len(mask),'framework_positions':len(framework),'fv_self_fit_A':M.fit(a,b)[0],'framework_self_fit_A':error,'cdr_after_framework_fit_A':rmsd(a[mask]@rotation+shift,b[mask])})
    checked_export('cdrDiagnostics',rows)
    native={rid:experimental_footprint(root,rid)for rid in contracts}
    checked_export('experimentalFootprints',[{**row,'positions':native[row['reference_id']][0],'contact_sites':len(native[row['reference_id']][0]),'checked_ecd_ca':native[row['reference_id']][1]}for row in load_json(definitions/'experimentalFootprints.json')])
    predictions={}
    for row in read_table(root/'data/results/per_prediction_metrics.csv')+read_table(root/'data/results/robustness_predictions.csv'):
        predictions[row['case_id'],row['model'],row['seed']]=row
    rows=[];candidate_sites={}
    for row in load_json(definitions/'contactFootprints.json'):
        prediction=predictions[row['case_id'],row['model'],row['seed']];observed={int(item[1])+45 for item in prediction['extracellular_cdr_contacts']};reference=set(native[row['reference_id']][0]);shared=observed&reference;union=observed|reference
        rows.append({**row,'predicted_sites':len(observed),'human_reference_sites':len(reference),'shared_sites':len(shared),'jaccard':len(shared)/len(union)if union else None,'human_site_recall':len(shared)/len(reference),'positions':sorted(observed)})
        if row['kind']=='designed_variant'and row['seed']==42:candidate_sites.setdefault((row['reference_id'],row['model']),[]).append(observed)
    checked_export('contactFootprints',rows)
    rows=[]
    for row in load_json(definitions/'contactHeatmap.json'):
        groups=candidate_sites[row['reference_id'],row['model']];count=sum(row['position']in group for group in groups);reference=row['position']in native[row['reference_id']][0]
        rows.append({**row,'position_label':str(row['position'])+('*'if reference else''),'reference_contact':reference,'candidate_contacts':count,'candidate_total':len(groups),'contact_percent':100*count/len(groups)})
    checked_export('contactHeatmap',rows)
    result={'rows':counts,'maximum_numeric_error':maximum,'numerical_checks':numerical_checks()};save_json(output/'summary.json',result);return result
