"""Reference-specific selection plus prespecified cross-seed robustness analysis."""
from pathlib import Path
from itertools import combinations,permutations
import csv
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import time
import gemmi
import numpy as np

from . import metrics as M

RUN=Path(os.environ['CD20_WORKSPACE']).resolve()
MODELS=['alphafold3','boltz2','esmfold2']
OUT=RUN/'results/analysis';OUT.mkdir(parents=True,exist_ok=True)


def save(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,indent=2,allow_nan=False)+'\n')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def table(p,rows):
    if rows:M.table(p,rows)
def paths(case,model,seed):
    cid=case['case_id'];base=RUN/'results/predictions'/('seed'+str(seed))
    if model=='alphafold3':return base/model/cid/(cid+'_model.cif'),base/model/cid/(cid+'_summary_confidences.json')
    if model=='boltz2':
        folder=base/model/'boltz_results_boltz2/predictions'/cid
        return folder/(cid+'_model_0.cif'),folder/('confidence_'+cid+'_model_0.json')
    return base/model/(cid+'.cif'),base/model/(cid+'.scores.json')


def contact_sensitivity(chains,contract):
    closest=float('inf')
    for target in ['A','B']:
        a=chains[target];xyz=a['xyz'][np.isin(a['residue_index'],contract['extracellular_core_indices'])]
        for binder in ['H','L']:
            b=chains[binder];other=b['xyz'][np.isin(b['residue_index'],contract['cdr_sequence_indices'][binder])]
            distance,_,_=M.contact(xyz,other,5.)
            closest=min(closest,distance)
    return {'minimum_extracellular_cdr_heavyatom_distance_A':closest,
        'contact_support_4A':closest<4.,'contact_support_4_5A':closest<4.5,'contact_support_5A':closest<5.}


def human_reference_pose(chains,reference):
    target=np.concatenate([reference['antigen'][k]['xyz'] for k in ['A','B']])
    fv=np.concatenate([reference['antibody'][k] for k in ['H','L']]);possibilities=[]
    for perm in permutations(['A','B']):
        mobile=np.concatenate([chains[p]['ca'][np.array(reference['antigen'][k]['core_indices'])-1] for p,k in zip(perm,['A','B'])])
        rmsd,rotation,shift=M.fit(mobile,target)
        binder=np.concatenate([chains[k]['ca'] for k in ['H','L']])@rotation+shift
        pose=float(np.sqrt(np.mean(np.sum((binder-fv)**2,axis=1))))
        possibilities.append((pose,rmsd,''.join(perm)))
    pose,antigen,perm=min(possibilities)
    own=np.concatenate([chains[k]['ca'] for k in ['H','L']])
    return {'fv_pose_ca_rmsd_A':pose,'antigen_fit_ca_rmsd_A':antigen,'antigen_chain_permutation':perm,
        'fv_self_fit_ca_rmsd_A':M.fit(own,fv)[0],'matched_antigen_ca':len(target),'reference_kind':'Human experimental complex, observed construct coverage'}


def read_prediction(case,model,seed,contract):
    structure,confidence=paths(case,model,seed)
    if not structure.is_file() or not confidence.is_file():return None,None
    chains=M.read_chains(structure,case['chains'])
    row={'reference_id':case['reference_id'],'family':case['family'],'case_id':case['case_id'],
        'candidate_id':case.get('candidate_id'),'kind':case['kind'],'route':case['route'],'model':model,'seed':seed,
        **M.native_scores(confidence,model),**M.geometry(chains,contract),**contact_sensitivity(chains,contract),
        'structure':str(structure),'confidence':str(confidence),'structure_sha256':sha(structure),'confidence_sha256':sha(confidence)}
    return row,chains


def make_overlay(case,loaded):
    destination=OUT/'top_candidate_structures'/case['reference_id']/case['candidate_id'];destination.mkdir(parents=True,exist_ok=True)
    reference=loaded['alphafold3'];lines=['reinitialize','bg_color white','set ray_opaque_background, 1','set cartoon_fancy_helices, 1']
    for model,color in [('alphafold3','blue'),('boltz2','orange'),('esmfold2','forest')]:
        source,_=paths(case,model,42);shutil.copyfile(source,destination/(model+'.cif'));structure=gemmi.read_structure(str(source))
        if model!='alphafold3':
            _,rotation,shift=M.pose(loaded[model],reference)
            for chain in structure[0]:
                for residue in chain:
                    for atom in residue:
                        xyz=np.array([atom.pos.x,atom.pos.y,atom.pos.z])@rotation+shift;atom.pos=gemmi.Position(*xyz)
        structure.make_mmcif_document().write_file(str(destination/(model+'_antigen_aligned.cif')))
        lines += ['load '+model+'_antigen_aligned.cif, '+model,'color '+color+', '+model,'set cartoon_transparency, 0.65, '+model+' and chain A+B']
    lines += ['hide everything','show cartoon','orient','zoom all, 8']
    (destination/'overlay.pml').write_text('\n'.join(lines)+'\n')


def primary():
    cases=json.loads((RUN/'inputs/primary_cases.json').read_text());index=json.loads((RUN/'reference_index.json').read_text())
    all_predictions=[];candidates=[];selected=[];controls=[];pair_rows=[];failures=[];reference_summaries=[]
    for reference in index:
        ident=reference['id'];base=RUN/'refs'/ident;contract=json.loads((base/'inputs/design_contract.json').read_text())
        geometry=json.loads((base/'inputs/reference_geometry.json').read_text());subset=[c for c in cases if c['reference_id']==ident]
        by_case={};rows_case={}
        for case in subset:
            by_case[case['case_id']]={};rows_case[case['case_id']]={}
            for model in MODELS:
                try:row,chains=read_prediction(case,model,42,contract)
                except Exception as error:
                    failures.append({'reference_id':ident,'case_id':case['case_id'],'model':model,'seed':42,'error':str(error)});continue
                if row is None:
                    failures.append({'reference_id':ident,'case_id':case['case_id'],'model':model,'seed':42,'error':'Missing output'});continue
                all_predictions.append(row);by_case[case['case_id']][model]=chains;rows_case[case['case_id']][model]=row
                if case['kind']=='parent_human':
                    controls.append({'reference_id':ident,'family':reference['family'],'kind':case['kind'],'model':model,'seed':42,
                        'interface_iptm':row['interface_iptm'],**human_reference_pose(chains,geometry)})
                elif case['kind']=='parent_dog':
                    initial=M.read_chains(base/'inputs/starting_complex.cif',case['chains']);pose,_,_=M.pose(chains,initial)
                    controls.append({'reference_id':ident,'family':reference['family'],'kind':case['kind'],'model':model,'seed':42,
                        'interface_iptm':row['interface_iptm'],**pose,'reference_kind':'Dog initial homology-transfer placement; not experimental binding truth'})
        eligible=[c for c in subset if c['kind']=='designed_variant' and len(by_case[c['case_id']])==3]
        percentiles={}
        for model in MODELS:
            values=[rows_case[c['case_id']][model]['interface_iptm'] for c in eligible]
            for c,pct in zip(eligible,M.percentiles(values)):percentiles[c['case_id'],model]=pct
        ref_rows=[]
        for case in eligible:
            loaded=by_case[case['case_id']];pred=rows_case[case['case_id']];poses=[]
            for a,b in combinations(MODELS,2):
                info,_,_=M.pose(loaded[a],loaded[b]);poses.append(info['fv_pose_ca_rmsd_A'])
                pair_rows.append({'reference_id':ident,'candidate_id':case['candidate_id'],'case_id':case['case_id'],'seed':42,'model_a':a,'model_b':b,**info})
            sequence=''.join(case['chains'][ch][i-1] for ch in ['H','L'] for i in contract['cdr_sequence_indices'][ch])
            row={'reference_id':ident,'family':reference['family'],'candidate_id':case['candidate_id'],'case_id':case['case_id'],'route':case['route'],
                'mutation_count':case['mutation_count'],'heavy_sequence':case['chains']['H'],'light_sequence':case['chains']['L'],'cdr_sequence':sequence,
                'designable_residues':len(sequence),'contact_support_models':sum(pred[m]['extracellular_cdr_contact_support'] for m in MODELS),
                'majority_contact':sum(pred[m]['extracellular_cdr_contact_support'] for m in MODELS)>=2,
                'consensus_percentile':float(np.median([percentiles[case['case_id'],m] for m in MODELS])),
                'median_cross_predictor_fv_pose_rmsd_A':float(np.median(poses)),
                'max_antigen_fv_clash_atom_pairs':max(pred[m]['antigen_fv_clash_atom_pairs'] for m in MODELS),
                'reference_complete_candidate_universe':len(eligible),'selection_status':'Computational exploratory candidate; no experimental binding claim'}
            for m in MODELS:
                row[m+'_interface_iptm']=pred[m]['interface_iptm'];row[m+'_within_reference_percentile']=percentiles[case['case_id'],m]
                for key in ['extracellular_cdr_residue_pairs','contact_support_4A','contact_support_4_5A','contact_support_5A']:row[m+'_'+key]=pred[m][key]
            ref_rows.append(row)
        ref_rows.sort(key=lambda x:(-int(x['majority_contact']),-x['consensus_percentile'],x['median_cross_predictor_fv_pose_rmsd_A'],x['candidate_id']))
        for route in ['rfd4','boltzgen']:
            kept=[]
            for rank,row in enumerate([x for x in ref_rows if x['route']==route],1):
                identities=[sum(a==b for a,b in zip(row['cdr_sequence'],k['cdr_sequence']))/len(row['cdr_sequence']) for k in kept]
                row['within_route_rank']=rank;row['selected_top5']=len(kept)<5 and all(x<=.9 for x in identities)
                if row['selected_top5']:
                    kept.append(row);selected.append(row)
                    case=next(c for c in eligible if c['case_id']==row['case_id']);make_overlay(case,by_case[case['case_id']])
        candidates.extend(ref_rows)
        reference_summaries.append({**reference,'candidate_count':len(ref_rows),'selected_count':sum(x['reference_id']==ident for x in selected),
            'majority_contact_candidates':sum(x['majority_contact'] for x in ref_rows),
            'median_cross_predictor_pose_A':float(np.median([x['median_cross_predictor_fv_pose_rmsd_A'] for x in ref_rows])) if ref_rows else None,
            **{m+'_interface_median':float(np.median([x[m+'_interface_iptm'] for x in ref_rows])) if ref_rows else None for m in MODELS}})
        print('REFERENCE_ANALYZED',ident,len(ref_rows),flush=True)
    table(OUT/'all_candidates_ranked.csv',candidates);table(OUT/'top_candidates.csv',selected);table(OUT/'per_prediction_metrics.csv',all_predictions)
    table(OUT/'candidate_cross_predictor_pose.csv',pair_rows);table(OUT/'parent_reference_pose_diagnostics.csv',controls);table(OUT/'reference_summary.csv',reference_summaries)
    save(OUT/'reference_summary.json',reference_summaries);save(OUT/'prediction_audit_failures.json',failures)
    selected_ids={x['case_id'] for x in selected};save(OUT/'selected_cases.json',[c for c in cases if c['case_id'] in selected_ids])
    save(OUT/'summary.json',{'phase':'PRIMARY_ANALYSIS_INCOMPLETE' if failures else 'PRIMARY_ANALYSIS_COMPLETE','references':len(index),'references_with_candidates':sum(x['candidate_count']>0 for x in reference_summaries),
        'candidates':len(candidates),'selected_candidates':len(selected),'primary_predictions_validated':len(all_predictions),'audit_failures':len(failures),
        'ranking_percentile_scope':'Within each reference and each predictor, common complete candidate universe; never pooled across references.',
        'generation_budget_per_reference_per_route':10,'primary_seed':42,'followup_seeds':[43,44],
        'reference_independence':'Reference-specific frameworks, poses, condition files, generation outputs and result groups. Predictor batching only shares loaded model weights.',
        'no_experimental_binding_truth':True,'completed_at_unix':time.time()})

    if failures:
        raise RuntimeError(f'{len(failures)} primary outputs missing or invalid; see prediction_audit_failures.json')


def robustness():
    chosen=json.loads((OUT/'selected_cases.json').read_text());parents=[c for c in json.loads((RUN/'inputs/primary_cases.json').read_text()) if c['kind'].startswith('parent_')]
    cases=chosen+parents;rows=[];summary=[];parent_rows=[];failures=[]
    for case in cases:
        contract=json.loads((RUN/'refs'/case['reference_id']/'inputs/design_contract.json').read_text());loaded={};pred=[]
        for seed in [42,43,44]:
            for model in MODELS:
                try:row,chains=read_prediction(case,model,seed,contract)
                except Exception as error:failures.append({'case_id':case['case_id'],'seed':seed,'model':model,'error':str(error)});continue
                if row is None:
                    failures.append({'case_id':case['case_id'],'seed':seed,'model':model,'error':'Missing output'});continue
                loaded[seed,model]=chains;pred.append(row);rows.append(row)
                if case['kind'].startswith('parent_'):
                    if case['kind']=='parent_human':
                        info=human_reference_pose(chains,json.loads((RUN/'refs'/case['reference_id']/'inputs/reference_geometry.json').read_text()))
                    else:
                        initial=M.read_chains(RUN/'refs'/case['reference_id']/'inputs/starting_complex.cif',case['chains']);info,_,_=M.pose(chains,initial)
                    parent_rows.append({'reference_id':case['reference_id'],'family':case['family'],'kind':case['kind'],'model':model,'seed':seed,'interface_iptm':row['interface_iptm'],**info})
        if case['kind']!='designed_variant':continue
        within=[];cross=[]
        for model in MODELS:
            for a,b in combinations([42,43,44],2):
                if (a,model) in loaded and (b,model) in loaded:within.append(M.pose(loaded[a,model],loaded[b,model])[0]['fv_pose_ca_rmsd_A'])
        for seed in [42,43,44]:
            for a,b in combinations(MODELS,2):
                if (seed,a) in loaded and (seed,b) in loaded:cross.append(M.pose(loaded[seed,a],loaded[seed,b])[0]['fv_pose_ca_rmsd_A'])
        row={'reference_id':case['reference_id'],'family':case['family'],'candidate_id':case['candidate_id'],'case_id':case['case_id'],'route':case['route'],
            'validated_prediction_count':len(pred),'planned_prediction_count':9,'contact_support_4A':sum(x['contact_support_4A'] for x in pred),
            'contact_support_4_5A':sum(x['contact_support_4_5A'] for x in pred),'contact_support_5A':sum(x['contact_support_5A'] for x in pred),
            'within_predictor_seed_pose_median_A':float(np.median(within)) if within else None,
            'cross_predictor_pose_median_A':float(np.median(cross)) if cross else None,
            'max_severe_clash_atom_pairs':max((x['antigen_fv_clash_atom_pairs'] for x in pred),default=None),
            'scope':'Selected from seed42 screen; followup43/44 assesses repeatability, not an unbiased prospective success rate.'}
        for model in MODELS:
            values=[x['interface_iptm'] for x in pred if x['model']==model]
            for suffix,fn in [('median',np.median),('min',min),('max',max)]:row[model+'_interface_'+suffix]=float(fn(values)) if values else None
        summary.append(row)
    table(OUT/'robustness_predictions.csv',rows);table(OUT/'robustness_summary.csv',summary);table(OUT/'parent_robustness.csv',parent_rows)
    save(OUT/'robustness_audit_failures.json',failures);save(OUT/'robustness_summary.json',summary)
    final=json.loads((OUT/'summary.json').read_text());final.update(phase='ROBUSTNESS_ANALYSIS_INCOMPLETE' if failures else 'ROBUSTNESS_ANALYSIS_COMPLETE',
        followup_predictions_validated=sum(x['seed']!=42 for x in rows),robustness_candidates=len(summary),
        robustness_fully_sampled_candidates=sum(x['validated_prediction_count']==9 for x in summary),
        total_predictions_validated=final['primary_predictions_validated']+sum(x['seed']!=42 for x in rows),completed_at_unix=time.time())
    save(OUT/'summary.json',final);print('MULTIREF_FINAL_SUMMARY',json.dumps(final),flush=True)
    if failures:
        raise RuntimeError(f'{len(failures)} repeatability outputs missing or invalid; see robustness_audit_failures.json')


if __name__=='__main__':
    if sys.argv[1]=='primary':primary()
    elif sys.argv[1]=='robustness':robustness()
    else:raise ValueError('Unknown phase')
