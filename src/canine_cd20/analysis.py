"""Reproduce selection and pose/repeatability results from the project dataset."""
from itertools import combinations
from pathlib import Path
import numpy as np
from . import metrics
from .project import contract, load_json, read_table, save_json, validate_pair, write_table

MODELS = ('alphafold3', 'boltz2', 'esmfold2')


class Coordinates:
    def __init__(self, root):
        self.index = load_json(Path(root) / 'data/coordinates/index.json')
        self.lookup = {(r['case_id'], r['model'], int(r['seed'])): r['key'] for r in self.index}
        with np.load(Path(root) / 'data/coordinates/predictions.npz', allow_pickle=False) as archive:
            self.arrays = {key: archive[key] for key in archive.files}
        for value in self.arrays.values():
            if value.ndim != 2 or value.shape[1] != 3 or not np.isfinite(value).all():
                raise ValueError('Invalid C-alpha coordinates')
            value.setflags(write=False)

    def chains(self, case_id, model, seed):
        prefix = self.lookup[case_id, model, int(seed)]
        return {chain: {'ca': self.arrays[prefix + '_' + chain]} for chain in ('A', 'B', 'H', 'L')}


def rank_candidates(root, pair_rows=None):
    root = Path(root)
    records = read_table(root / 'data/results/all_candidates_ranked.csv')
    predictions = read_table(root / 'data/results/per_prediction_metrics.csv')
    pairs = pair_rows if pair_rows is not None else read_table(root / 'data/results/candidate_cross_predictor_pose.csv')
    model_scores = {(r['case_id'], r['model']): r for r in predictions if r['kind'] == 'designed_variant'}
    ranked, selected = [], []
    config = load_json(root / 'configs/ranking.json')
    for reference in load_json(root / 'configs/study.json')['reference_ids']:
        group = [dict(r) for r in records if r['reference_id'] == reference]
        ref_contract = contract(root, reference)
        for row in group:
            row['cdr_sequence'] = validate_pair(row, ref_contract)
        for model in MODELS:
            percentiles = metrics.percentiles([model_scores[r['case_id'], model]['interface_iptm'] for r in group])
            for row, value in zip(group, percentiles):
                row[model + '_within_reference_percentile'] = value
                row[model + '_interface_iptm'] = model_scores[row['case_id'], model]['interface_iptm']
        for row in group:
            matching = [r for r in pairs if r['case_id'] == row['case_id'] and int(r['seed']) == 42]
            if len(matching) != 3:
                raise ValueError('Expected three primary model pairs: ' + row['case_id'])
            row['median_cross_predictor_fv_pose_rmsd_A'] = float(np.median([r['fv_pose_ca_rmsd_A'] for r in matching]))
            row['consensus_percentile'] = float(np.median([row[m + '_within_reference_percentile'] for m in MODELS]))
            row['contact_support_models'] = sum(bool(model_scores[row['case_id'], m]['extracellular_cdr_contact_support']) for m in MODELS)
            row['majority_contact'] = row['contact_support_models'] >= config['contact_support_models_for_stronger_evidence']
            row['max_antigen_fv_clash_atom_pairs'] = max(model_scores[row['case_id'], m]['antigen_fv_clash_atom_pairs'] for m in MODELS)
        group.sort(key=lambda r: (-int(r['majority_contact']), -r['consensus_percentile'], r['median_cross_predictor_fv_pose_rmsd_A'], r['candidate_id']))
        for route in ('rfd4', 'boltzgen'):
            kept = []
            for rank, row in enumerate([r for r in group if r['route'] == route], 1):
                identities = [sum(a == b for a, b in zip(row['cdr_sequence'], k['cdr_sequence'])) / len(row['cdr_sequence']) for k in kept]
                row['within_route_rank'] = rank
                row['selected_top5'] = len(kept) < config['max_selected_per_generation_route'] and all(x <= config['max_cdr_sequence_identity_to_already_selected'] for x in identities)
                if row['selected_top5']:
                    kept.append(row)
                    selected.append(row)
        ranked.extend(group)
    return ranked, selected


def pair_comparisons(root, coordinates):
    rows = read_table(Path(root) / 'data/results/candidate_cross_predictor_pose.csv')
    output = []
    for row in rows:
        value, _, _ = metrics.pose(coordinates.chains(row['case_id'], row['model_a'], row['seed']),
                                   coordinates.chains(row['case_id'], row['model_b'], row['seed']))
        output.append({**row, **value})
    return output


def repeatability(root, coordinates, selected):
    rows = read_table(Path(root) / 'data/results/robustness_predictions.csv')
    summaries = []
    for item in selected:
        case = item['case_id']
        predictions = [r for r in rows if r['case_id'] == case]
        within, between = [], []
        for model in MODELS:
            for a, b in combinations((42, 43, 44), 2):
                within.append(metrics.pose(coordinates.chains(case, model, a), coordinates.chains(case, model, b))[0]['fv_pose_ca_rmsd_A'])
        for seed in (42, 43, 44):
            for a, b in combinations(MODELS, 2):
                between.append(metrics.pose(coordinates.chains(case, a, seed), coordinates.chains(case, b, seed))[0]['fv_pose_ca_rmsd_A'])
        value = {k: item[k] for k in ('reference_id', 'family', 'candidate_id', 'case_id', 'route')}
        value.update(validated_prediction_count=len(predictions), planned_prediction_count=9,
                     contact_support_4A=sum(r['contact_support_4A'] for r in predictions),
                     contact_support_4_5A=sum(r['contact_support_4_5A'] for r in predictions),
                     contact_support_5A=sum(r['contact_support_5A'] for r in predictions),
                     within_predictor_seed_pose_median_A=float(np.median(within)),
                     cross_predictor_pose_median_A=float(np.median(between)),
                     max_severe_clash_atom_pairs=max(r['antigen_fv_clash_atom_pairs'] for r in predictions))
        for model in MODELS:
            scores = [r['interface_iptm'] for r in predictions if r['model'] == model]
            for suffix, function in [('median', np.median), ('min', min), ('max', max)]:
                value[model + '_interface_' + suffix] = float(function(scores))
        summaries.append(value)
    return summaries


def reproduce(root, output):
    root, output = Path(root), Path(output)
    if output.exists():
        raise FileExistsError('Use a new output directory: ' + str(output))
    coordinates = Coordinates(root)
    pairs = pair_comparisons(root, coordinates)
    ranked, selected = rank_candidates(root, pairs)
    repeated = repeatability(root, coordinates, selected)
    expected = {r['case_id']: r for r in read_table(root / 'data/results/all_candidates_ranked.csv')}
    rank_errors = [r['case_id'] for r in ranked if r['within_route_rank'] != expected[r['case_id']]['within_route_rank'] or r['selected_top5'] != expected[r['case_id']]['selected_top5']]
    pose_expected = read_table(root / 'data/results/candidate_cross_predictor_pose.csv')
    pose_error = max(abs(a['fv_pose_ca_rmsd_A'] - b['fv_pose_ca_rmsd_A']) for a, b in zip(pairs, pose_expected))
    repeat_expected = {r['case_id']: r for r in read_table(root / 'data/results/robustness_summary.csv')}
    repeat_error = max(abs(r[field] - repeat_expected[r['case_id']][field]) for r in repeated
                       for field in ('within_predictor_seed_pose_median_A', 'cross_predictor_pose_median_A'))
    if rank_errors or pose_error > 1e-8 or repeat_error > 1e-8:
        raise ValueError('Reproduction mismatch: ' + str((rank_errors, pose_error, repeat_error)))
    output.mkdir(parents=True)
    write_table(output / 'all_candidates_ranked.csv', ranked)
    write_table(output / 'top_candidates.csv', selected)
    write_table(output / 'candidate_cross_predictor_pose.csv', pairs)
    write_table(output / 'robustness_summary.csv', repeated)
    (output / 'top_candidates_paired.fasta').write_text(''.join('>' + r['reference_id'] + '|' + r['candidate_id'] + '|VH\n' + r['heavy_sequence'] + '\n>' + r['reference_id'] + '|' + r['candidate_id'] + '|VL\n' + r['light_sequence'] + '\n' for r in selected))
    summary = {'references': 7, 'candidates': len(ranked), 'selected_pairs': len(selected),
               'canonical_predictions': len(coordinates.index), 'primary_model_pairs': len(pairs),
               'repeated_candidates': len(repeated), 'ranking_mismatches': len(rank_errors),
               'maximum_pose_difference_A': pose_error, 'maximum_repeatability_difference_A': repeat_error}
    save_json(output / 'summary.json', summary)
    return summary
