"""Command-line entry for the project workflow."""
import argparse
import json
import os
from pathlib import Path
from .project import contract, load_json, project_root, save_json


def main():
    parser = argparse.ArgumentParser(description='Canine CD20 design and analysis project')
    parser.add_argument('--root', type=Path, help='Project checkout; defaults to the current checkout')
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('reproduce', help='Recompute selection, pair poses, and repeatability on the included data')
    p.add_argument('--output', type=Path, required=True)
    p = commands.add_parser('reproduce-diagnostics', help='Recompute target/Fv/CDR, experimental footprints and design-pose diagnostics')
    p.add_argument('--output', type=Path, required=True)
    p = commands.add_parser('rebuild-inputs', help='Rebuild starting assemblies from experimental structures and the dog monomer')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--reference')
    p = commands.add_parser('prepare', help='Materialize frozen design and predictor inputs')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--reference')
    p.add_argument('--with-predictions', action='store_true', help='Unpack the included native model outputs')
    p.add_argument('--with-designs', action='store_true', help='Unpack the included generated structures')
    p = commands.add_parser('plan', help='Print configured external model commands; execution is opt-in')
    p.add_argument('--workspace', type=Path, required=True)
    p.add_argument('--tools', type=Path, required=True)
    p.add_argument('--stage', choices=['generation', 'primary', 'followup'], required=True)
    p.add_argument('--reference')
    p.add_argument('--execute', action='store_true', help='Actually run installed model programs')
    p = commands.add_parser('collect-designs', help='Validate generated structures and prepare primary prediction cases')
    p.add_argument('--workspace', type=Path, required=True)
    p = commands.add_parser('prepare-followup', help='Use this workspace selection to build seed43/44 inputs')
    p.add_argument('--workspace', type=Path, required=True)
    p = commands.add_parser('analyze-workspace', help='Analyze externally produced native model outputs')
    p.add_argument('--workspace', type=Path, required=True)
    p.add_argument('--stage', choices=['primary', 'robustness'], required=True)
    p = commands.add_parser('inspect-structure', help='Measure all-atom contacts/clashes on a supplied complex')
    p.add_argument('--structure', type=Path, required=True)
    p.add_argument('--reference', required=True)
    p.add_argument('--model', choices=['alphafold3', 'boltz2', 'esmfold2'])
    p.add_argument('--confidence', type=Path)
    p.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = project_root(args.root)
    if args.command == 'reproduce':
        from .analysis import reproduce
        result = reproduce(root, args.output)
    elif args.command == 'reproduce-diagnostics':
        from .diagnostics import reproduce_diagnostics
        result = reproduce_diagnostics(root, args.output)
    elif args.command == 'rebuild-inputs':
        from .reference_inputs import rebuild_inputs
        result = rebuild_inputs(root, args.output, args.reference)
    elif args.command == 'prepare':
        from .workflow import prepare
        result = prepare(root, args.output, args.reference, args.with_predictions, args.with_designs)
    elif args.command == 'plan':
        from .workflow import plan, execute
        result = plan(root, args.workspace, load_json(args.tools), args.stage, args.reference)
        if args.execute:
            execute(result)
    elif args.command == 'collect-designs':
        from .workflow import collect_designs
        result = collect_designs(root, args.workspace)
    elif args.command == 'prepare-followup':
        from .workflow import prepare_followup
        result = {'cases_per_seed': prepare_followup(args.workspace)}
    elif args.command == 'analyze-workspace':
        os.environ['CD20_WORKSPACE'] = str(args.workspace.resolve())
        from . import pipeline_analysis
        getattr(pipeline_analysis, args.stage)()
        result = {'output': str(args.workspace / 'results/analysis')}
    else:
        from . import metrics
        value = contract(root, args.reference)
        expected = {'A': value['target_core_sequence'], 'B': value['target_core_sequence'], **value['parent_sequences']}
        chains = metrics.read_chains(args.structure)
        if set(chains) != set(expected):
            raise ValueError('Expected A/B/H/L complex')
        if any(len(chains[k]['sequence']) != len(expected[k]) for k in expected):
            raise ValueError('Chain lengths do not match reference contract')
        if any(chains[k]['sequence'] != expected[k] for k in ('A', 'B')):
            raise ValueError('Target sequence differs from the reference design contract')
        from .project import validate_pair
        validate_pair({'case_id': str(args.structure), 'heavy_sequence': chains['H']['sequence'], 'light_sequence': chains['L']['sequence']}, value)
        result = metrics.geometry(chains, value)
        if args.confidence:
            if not args.model:
                parser.error('--confidence requires --model')
            result.update(metrics.native_scores(args.confidence, args.model))
        if args.output:
            save_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
