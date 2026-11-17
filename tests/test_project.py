"""Numerical and completed-study regressions; no inference or network access."""
from collections import Counter
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import gzip
import hashlib
import os
import subprocess
import sys
import unittest
from unittest.mock import patch
import numpy as np
import yaml
from canine_cd20 import metrics
from canine_cd20.analysis import Coordinates, rank_candidates, pair_comparisons, repeatability
from canine_cd20.diagnostics import numerical_checks
from canine_cd20.project import contract, load_json, read_table, validate_pair
from canine_cd20.reference_inputs import rebuild_inputs
from canine_cd20.workflow import prepare, plan, prediction_inputs

ROOT = Path(__file__).resolve().parents[1]


class GeometryTests(unittest.TestCase):
    def test_proper_rigid_fit(self):
        xyz = np.random.default_rng(7).normal(size=(30, 3))
        rotation = np.array([[0., -1., 0.], [1., 0., 0.], [0., 0., 1.]])
        moved = xyz @ rotation + [10, -3, 7]
        error, actual, shift = metrics.fit(moved, xyz)
        self.assertLess(error, 1e-12)
        self.assertAlmostEqual(np.linalg.det(actual), 1.)
        np.testing.assert_allclose(moved @ actual + shift, xyz, atol=1e-12)

    def test_reflections_cannot_be_fitted_as_rotations(self):
        xyz = np.random.default_rng(4).normal(size=(30, 3))
        reflected = xyz * [-1, 1, 1]
        error, rotation, _ = metrics.fit(reflected, xyz)
        self.assertGreater(error, 0.5)
        self.assertAlmostEqual(np.linalg.det(rotation), 1.)

    def test_contact_threshold_is_strict(self):
        distance, left, right = metrics.contact(np.array([[0., 0., 0.]]), np.array([[4.5, 0., 0.], [4.499, 0., 0.]]), 4.5)
        self.assertAlmostEqual(distance, 4.499)
        self.assertEqual(left.tolist(), [0])
        self.assertEqual(right.tolist(), [1])

    def test_pose_translation_rotation_and_subunit_exchange(self):
        self.assertEqual(len(numerical_checks()), 4)

    def test_tied_rank_percentiles(self):
        self.assertEqual(metrics.percentiles([5, 5, 5]), [.5, .5, .5])
        self.assertEqual(metrics.percentiles([10]), [.5])
        self.assertEqual(metrics.percentiles([1, 2, 2, 4]), [0., .5, .5, 1.])


class CompletedStudyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.coordinates = Coordinates(ROOT)
        cls.pairs = pair_comparisons(ROOT, cls.coordinates)
        cls.ranked, cls.selected = rank_candidates(ROOT, cls.pairs)

    def test_unique_coordinate_universe(self):
        self.assertEqual(len(self.coordinates.lookup), 966)
        self.assertEqual(len(self.coordinates.index), 966)
        self.assertTrue(all(not value.flags.writeable for value in self.coordinates.arrays.values()))

    def test_all_candidates_preserve_frozen_frameworks(self):
        self.assertEqual(len(self.ranked), 140)
        for row in self.ranked:
            value = validate_pair(row, contract(ROOT, row['reference_id']))
            self.assertEqual(value, row['cdr_sequence'])

    def test_framework_mutation_is_rejected(self):
        row = deepcopy(self.ranked[0]); value = contract(ROOT, row['reference_id'])
        index = next(i for i in range(1, len(row['heavy_sequence']) + 1) if i not in value['cdr_sequence_indices']['H']) - 1
        sequence = list(row['heavy_sequence']); sequence[index] = 'A' if sequence[index] != 'A' else 'C'
        row['heavy_sequence'] = ''.join(sequence)
        with self.assertRaisesRegex(ValueError, 'Framework mutation'):
            validate_pair(row, value)

    def test_selection_matches_study_and_route_diversity(self):
        expected = {r['case_id']: r for r in read_table(ROOT/'data/results/all_candidates_ranked.csv')}
        for row in self.ranked:
            self.assertEqual(row['within_route_rank'], expected[row['case_id']]['within_route_rank'])
            self.assertEqual(row['selected_top5'], expected[row['case_id']]['selected_top5'])
        groups = Counter((r['reference_id'], r['route']) for r in self.selected)
        self.assertEqual(len(groups), 14)
        self.assertEqual(set(groups.values()), {5})
        for a in self.selected:
            for b in self.selected:
                if a['case_id'] != b['case_id'] and (a['reference_id'], a['route']) == (b['reference_id'], b['route']):
                    self.assertLessEqual(sum(x == y for x, y in zip(a['cdr_sequence'], b['cdr_sequence'])) / len(a['cdr_sequence']), .9)

    def test_all_primary_pair_poses(self):
        self.assertEqual(len(self.pairs), 420)
        expected = read_table(ROOT/'data/results/candidate_cross_predictor_pose.csv')
        for row, reference in zip(self.pairs, expected):
            for field in ('fv_pose_ca_rmsd_A', 'fv_self_fit_ca_rmsd_A', 'antigen_fit_ca_rmsd_A'):
                self.assertAlmostEqual(row[field], reference[field], places=10)

    def test_selected_candidate_repeatability(self):
        expected = {r['case_id']: r for r in read_table(ROOT/'data/results/robustness_summary.csv')}
        rows = repeatability(ROOT, self.coordinates, self.selected)
        self.assertEqual(len(rows), 70)
        for row in rows:
            self.assertEqual(row['validated_prediction_count'], 9)
            for field in ('within_predictor_seed_pose_median_A', 'cross_predictor_pose_median_A'):
                self.assertAlmostEqual(row[field], expected[row['case_id']][field], places=10)

    def test_native_structure_example_and_confidence(self):
        case = load_json(ROOT/'examples/structure_comparison/case.json')
        candidates = [r for r in read_table(ROOT/'data/results/per_prediction_metrics.csv') if r['case_id'] == case['case_id']]
        self.assertEqual(len(candidates), 3)
        for row in candidates:
            model = row['model']; path = ROOT/'examples/structure_comparison'/(model+'.cif.gz')
            expected = next(c for c in load_json(ROOT/'data/inputs/cases.json') if c['case_id'] == case['case_id'])['chains']
            chains = metrics.read_chains(path, expected)
            actual = metrics.geometry(chains, contract(ROOT, case['reference_id']))
            actual.update(metrics.native_scores(ROOT/'examples/structure_comparison'/(model+'.confidence.json'), model))
            for field in ('extracellular_cdr_residue_pairs', 'antigen_fv_clash_atom_pairs', 'extracellular_cdr_contact_support', 'interface_iptm'):
                self.assertEqual(actual[field], row[field])

    def test_native_prediction_archive_identity(self):
        index = load_json(ROOT/'data/predictions/index.json')
        self.assertEqual(len(index), 966)
        for row in (index[0], index[-1]):
            for kind in ('structure', 'confidence'):
                content = gzip.decompress((ROOT/row[kind+'_file']).read_bytes())
                self.assertEqual(hashlib.sha256(content).hexdigest(), row[kind+'_sha256'])


class WorkspaceTests(unittest.TestCase):
    def test_fresh_workspace_has_only_parent_cases(self):
        with TemporaryDirectory() as temp:
            work = Path(temp)/'study'; result = prepare(ROOT, work, '6VJA')
            self.assertEqual(result['primary_cases'], 2)
            self.assertFalse((work/'inputs/predictions/seed43').exists())
            self.assertTrue(all(case['kind'].startswith('parent_') for case in load_json(work/'inputs/primary_cases.json')))
            af = load_json(next((work/'inputs/predictions/seed42/alphafold3').glob('*.json')))
            self.assertTrue(all(s['protein']['unpairedMsa'] == '' and s['protein']['templates'] == [] for s in af['sequences']))
            boltz = yaml.safe_load(next((work/'inputs/predictions/seed42/boltz2').glob('*.yaml')).read_text())
            self.assertTrue(all(s['protein']['msa'] == 'empty' for s in boltz['sequences']))
            with self.assertRaises(FileExistsError): prepare(ROOT, work, '6VJA')

    def test_invalid_reference_does_not_create_workspace(self):
        with TemporaryDirectory() as temp:
            work = Path(temp)/'study'
            with self.assertRaises(ValueError): prepare(ROOT, work, 'XXXX')
            self.assertFalse(work.exists())

    def test_plans_do_not_execute_and_keep_seed_budgets(self):
        with TemporaryDirectory() as temp:
            work = Path(temp)/'study'; prepare(ROOT, work, '6VJA')
            tools = load_json(ROOT/'configs/tools.example.json')
            with patch('subprocess.run', side_effect=AssertionError('Plan must not run inference')):
                commands = plan(ROOT, work, tools, 'generation')
                rfd = [r for r in commands if ':rfd4:' in r['name']]
                self.assertEqual([[a for a in r['argv'] if a.startswith(('num_replicates=', 'seed='))] for r in rfd], [['num_replicates=1', 'seed=101'], ['num_replicates=9', 'seed=102']])
                self.assertEqual(len(plan(ROOT, work, tools, 'primary')), 3)
                self.assertEqual(len(plan(ROOT, work, tools, 'followup')), 6)
                self.assertTrue(all(Path(command['cwd']).is_absolute() for command in commands))

    def test_missing_native_outputs_fail_with_incomplete_status(self):
        with TemporaryDirectory() as temp:
            work = Path(temp)/'study'; prepare(ROOT, work, '6VJA')
            result = subprocess.run([sys.executable, '-B', '-m', 'canine_cd20', '--root', str(ROOT), 'analyze-workspace', '--workspace', str(work), '--stage', 'primary'], capture_output=True, text=True, env=os.environ.copy())
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('primary outputs missing or invalid', result.stderr)
            summary = load_json(work/'results/analysis/summary.json')
            self.assertEqual(summary['phase'], 'PRIMARY_ANALYSIS_INCOMPLETE')
            self.assertEqual(summary['audit_failures'], 6)

    def test_rewriting_cases_removes_obsolete_model_inputs(self):
        with TemporaryDirectory() as temp:
            work = Path(temp)/'study'; prepare(ROOT, work, '6VJA')
            cases = load_json(work/'inputs/primary_cases.json')
            path = prediction_inputs(work, cases[:1], 42)
            self.assertEqual(len(list((path/'alphafold3').glob('*.json'))), 1)
            self.assertEqual(len(list((path/'boltz2').glob('*.yaml'))), 1)

    def test_rebuild_frozen_reference_input(self):
        with TemporaryDirectory() as temp:
            result = rebuild_inputs(ROOT, Path(temp)/'rebuilt', '6VJA')
            self.assertEqual(result[0]['maximum_coordinate_difference_A'], 0.)


if __name__ == '__main__':
    unittest.main()
