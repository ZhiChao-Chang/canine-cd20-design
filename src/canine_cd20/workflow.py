"""Local preparation and explicit execution plans for the two design routes."""
from pathlib import Path
import gzip
import json
import os
import shutil
import subprocess
import sys
import yaml
from .project import contract, load_json, read_table, save_json


def materialize_paths(value, inputs):
    if isinstance(value, dict):
        return {key: materialize_paths(item, inputs) for key, item in value.items()}
    if isinstance(value, list):
        return [materialize_paths(item, inputs) for item in value]
    if value in ('starting_complex.cif', 'starting_complex_v2.cif'):
        return str(inputs / value)
    return value


def prediction_inputs(workspace, cases, seed):
    output = Path(workspace) / 'inputs/predictions' / ('seed' + str(seed))
    # These directories contain only generated model inputs. Remove stale case
    # files when a fresh generation produces a different candidate set.
    for model, suffix in [('alphafold3', '.json'), ('boltz2', '.yaml')]:
        for path in (output / model).glob('*' + suffix):
            path.unlink()
    for model in ('alphafold3', 'boltz2'):
        (output / model).mkdir(parents=True, exist_ok=True)
    for case in cases:
        chains = case['chains']
        if list(chains) != ['A', 'B', 'H', 'L']:
            raise ValueError('Expected two targets and paired H/L')
        af = {'name': case['case_id'], 'modelSeeds': [seed], 'dialect': 'alphafold3', 'version': 1,
              'sequences': [{'protein': {'id': role, 'sequence': sequence, 'unpairedMsa': '', 'pairedMsa': '', 'templates': []}} for role, sequence in chains.items()]}
        boltz = {'version': 1, 'sequences': [{'protein': {'id': role, 'sequence': sequence, 'msa': 'empty'}} for role, sequence in chains.items()]}
        save_json(output / 'alphafold3' / (case['case_id'] + '.json'), af)
        (output / 'boltz2' / (case['case_id'] + '.yaml')).write_text(yaml.safe_dump(boltz, sort_keys=False))
    save_json(output / 'cases.json', cases)
    return output


def prepare(root, output, reference=None, with_predictions=False, with_designs=False):
    root, output = Path(root), Path(output).resolve()
    if output.exists():
        raise FileExistsError('Use a new workspace directory')
    index = load_json(root / 'data/inputs/reference_index.json')
    if reference:
        index = [r for r in index if r['id'] == reference]
        if not index:
            raise ValueError('Unknown reference: ' + reference)
    output.mkdir(parents=True)
    for name in ('reports', 'logs', 'results', 'inputs'):
        (output / name).mkdir()
    save_json(output / 'reference_index.json', index)
    save_json(output / 'experiment_contract.json', load_json(root / 'configs/study.json'))
    ids = {r['id'] for r in index}
    for item in index:
        source = root / 'data/inputs/references' / item['id']
        destination = output / 'refs' / item['id'] / 'inputs'
        destination.mkdir(parents=True)
        for name in ('reports', 'results', 'logs'):
            (destination.parent / name).mkdir()
        for path in source.iterdir():
            if path.name.endswith('.cif.gz'):
                (destination / path.name[:-3]).write_bytes(gzip.decompress(path.read_bytes()))
            elif path.suffix == '.yaml':
                value = materialize_paths(yaml.safe_load(path.read_text()), destination)
                (destination / path.name).write_text(yaml.safe_dump(value, sort_keys=False))
            else:
                shutil.copyfile(path, destination / path.name)
    replay = with_predictions or with_designs
    cases = [r for r in load_json(root / 'data/inputs/cases.json')
             if r['reference_id'] in ids and (replay or r['kind'].startswith('parent_'))]
    if with_designs:
        for item in load_json(root / 'data/designs/index.json'):
            if item['reference_id'] not in ids:
                continue
            target = output / item['workspace_structure']
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(gzip.decompress((root / item['file']).read_bytes()))
            for case in cases:
                if case['case_id'] == item['case_id']:
                    case['generation_structure'] = str(target)
    if with_predictions:
        for item in load_json(root / 'data/predictions/index.json'):
            if item['reference_id'] not in ids:
                continue
            for field in ('structure', 'confidence'):
                target = output / item['workspace_' + field]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(gzip.decompress((root / item[field + '_file']).read_bytes()))
    save_json(output / 'inputs/primary_cases.json', cases)
    prediction_inputs(output, cases, 42)
    selected = {r['case_id'] for r in read_table(root / 'data/results/top_candidates.csv')}
    followup = [r for r in cases if r['case_id'] in selected or r['kind'].startswith('parent_')]
    if replay:
        for seed in (43, 44):
            prediction_inputs(output, followup, seed)
    return {'workspace': str(output), 'references': len(index), 'primary_cases': len(cases), 'followup_cases_per_seed': len(followup) if replay else 0}


def collect_designs(root, workspace):
    root, workspace = Path(root), Path(workspace).resolve()
    cases = []
    for item in load_json(workspace / 'reference_index.json'):
        reference = item['id']
        base = workspace / 'refs' / reference
        environment = os.environ.copy()
        environment['CD20_REFERENCE_ROOT'] = str(base)
        subprocess.run([sys.executable, str(root / 'scripts/audit_candidates.py'), '--output', 'all_candidates.json'], env=environment, check=True)
        value = load_json(base / 'inputs/design_contract.json')
        accepted = {r['candidate_id']: r for r in load_json(base / 'reports/all_candidates.json') if r.get('phase') == 'PASSED' and r.get('variant')}
        for ident, record in accepted.items():
            cases.append({'case_id': 'ref' + reference.lower() + '_' + ident, 'candidate_id': ident,
                          'reference_id': reference, 'family': item['family'], 'kind': 'designed_variant', 'route': record['route'],
                          'chains': {'A': value['target_core_sequence'], 'B': value['target_core_sequence'], **record['sequences']},
                          'mutation_count': record['mutation_count'], 'generation_structure': record['normalized_structure']})
        human = load_json(base / 'inputs/reference_geometry.json')['human_target_sequence']
        for species, sequence in [('dog', value['target_core_sequence']), ('human', human)]:
            cases.append({'case_id': 'ref' + reference.lower() + '_parent_' + species, 'candidate_id': None,
                          'reference_id': reference, 'family': item['family'], 'kind': 'parent_' + species, 'route': 'control',
                          'chains': {'A': sequence, 'B': sequence, **value['parent_sequences']}})
    if not any(case['kind'] == 'designed_variant' for case in cases):
        raise ValueError('No valid generated candidate; inspect model outputs and constraint checks')
    save_json(workspace / 'inputs/primary_cases.json', cases)
    prediction_inputs(workspace, cases, 42)
    return {'cases': len(cases), 'variants': sum(r['kind'] == 'designed_variant' for r in cases)}


def prepare_followup(workspace):
    workspace = Path(workspace)
    selected = load_json(workspace / 'results/analysis/selected_cases.json')
    parents = [r for r in load_json(workspace / 'inputs/primary_cases.json') if r['kind'].startswith('parent_')]
    for seed in (43, 44):
        prediction_inputs(workspace, selected + parents, seed)
    return len(selected + parents)


def plan(root, workspace, tools, stage, reference=None):
    root, workspace = Path(root).resolve(), Path(workspace).resolve()
    commands = []
    def add(name, argv, cwd=None, env=None):
        commands.append({'name': name, 'argv': [str(a) for a in argv], 'cwd': str(cwd or workspace), 'env': env or {}})
    if stage == 'generation':
        index = load_json(workspace / 'reference_index.json')
        if reference:
            index = [r for r in index if r['id'] == reference]
            if not index:
                raise ValueError('Reference is not in this workspace')
        for item in index:
            base = workspace / 'refs' / item['id']
            rfd, boltz = tools['rfd4'], tools['boltzgen']
            add(item['id'] + ':materialize', [rfd['python'], Path(rfd['repository']) / 'scripts/write_condition_spec_cifs.py', base / 'inputs/rfd4.yaml', '--out-dir', base / 'results/rfd4_input'], rfd['repository'])
            add(item['id'] + ':conditioning', [sys.executable, root / 'scripts/audit_conditioning.py'], env={'CD20_REFERENCE_ROOT': str(base)})
            add(item['id'] + ':check', [boltz['python'], boltz['entry'], 'check', base / 'inputs/boltzgen.yaml', '--output', base / 'results/boltzgen_input'])
            settings = load_json(root / 'configs/study.json')['generation']
            if sum(g['count'] for g in settings['groups']) != settings['attempts_per_reference_per_route']:
                raise ValueError('Generation groups exceed or underfill the configured attempt budget')
            for setting in settings['groups']:
                group, count, seed = setting['name'], setting['count'], setting['seed']
                add(item['id'] + ':rfd4:' + group, [rfd['python'], rfd['entry'], 'inference_experiment=quickstart', 'recycle_strategy=high/front_loaded', 'inputs=' + str(base / 'inputs/rfd4.yaml'), 'out_dir=' + str(base / ('results/rfd4_' + group)), 'num_replicates=' + str(count), 'batch_size=1', 'num_workers=1', 'seed=' + str(seed), 'hf_ckpt_path=' + rfd['checkpoint']], rfd['repository'], {'PYTHONHASHSEED': str(seed)})
                argv = [boltz['python'], root / 'scripts/seeded_boltzgen.py', 'run', base / 'inputs/boltzgen.yaml', '--output', base / ('results/boltzgen_' + group), '--protocol', 'antibody-anything', '--num_designs', count, '--budget', 5, '--devices', 1, '--num_workers', 1, '--no_subprocess', '--design_checkpoints', 'huggingface:boltzgen/boltzgen-1:boltzgen1_diverse.ckpt']
                if group == 'batch':
                    argv += ['huggingface:boltzgen/boltzgen-1:boltzgen1_adherence.ckpt']
                add(item['id'] + ':boltzgen:' + group, argv + ['--steps', 'design', 'inverse_folding'], env={'CD20_DESIGN_SEED': str(seed)})
    elif stage in ('primary', 'followup'):
        for seed in ([42] if stage == 'primary' else [43, 44]):
            inputs = workspace / 'inputs/predictions' / ('seed' + str(seed))
            output = workspace / 'results/predictions' / ('seed' + str(seed))
            af, boltz, esm = tools['alphafold3'], tools['boltz2'], tools['esmfold2']
            add('af3:' + str(seed), [af['python'], Path(af['repository']) / 'run_alphafold.py', '--input_dir=' + str(inputs / 'alphafold3'), '--model_dir=' + af['model_dir'], '--output_dir=' + str(output / 'alphafold3'), '--run_data_pipeline=false', '--num_diffusion_samples=1'], af['repository'], {'XLA_PYTHON_CLIENT_PREALLOCATE': 'false', **af.get('env', {})})
            add('boltz2:' + str(seed), [boltz['python'], boltz['entry'], 'predict', inputs / 'boltz2', '--out_dir', output / 'boltz2', '--cache', boltz['cache'], '--accelerator', 'gpu', '--devices', 1, '--model', 'boltz2', '--seed', seed, '--diffusion_samples', 1])
            add('esmfold2:' + str(seed), [esm['python'], root / 'scripts/run_esmfold2.py'], env={'CD20_WORKSPACE': str(workspace), 'CD20_PREDICTION_SEED': str(seed), 'CD20_CASES': str(inputs / 'cases.json'), 'CD20_ESM_OUTPUT': str(output / 'esmfold2'), 'CD20_ESM_MODEL_DIR': esm['model_dir'], 'CD20_ANALYSIS_PYTHON': sys.executable, **esm.get('env', {})})
    else:
        raise ValueError('Unknown stage')
    return commands


def execute(commands):
    for command in commands:
        environment = os.environ.copy()
        environment.update(command['env'])
        subprocess.run(command['argv'], cwd=command['cwd'], env=environment, check=True)
