"""Per-case validated ESMFold2 inference with an explicit fixed seed."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time
import torch
from esm.models.esmfold2 import EsmFold2Model,ESMFold2InputBuilder,StructurePredictionInput,ProteinInput

RUN=Path(os.environ['CD20_WORKSPACE'])
MODEL_ROOT=Path(os.environ['CD20_ESM_MODEL_DIR'])
seed=int(os.environ['CD20_PREDICTION_SEED']);cases=json.loads(Path(os.environ['CD20_CASES']).read_text())
output=Path(os.environ['CD20_ESM_OUTPUT']);output.mkdir(parents=True,exist_ok=True)
model=EsmFold2Model.from_pretrained(MODEL_ROOT,device='cuda').eval()
builder=ESMFold2InputBuilder(ccd_cache=MODEL_ROOT);records=[]
validation="""import sys,json,math,gemmi
s=gemmi.read_structure(sys.argv[1],format=gemmi.CoorFormat.Mmcif)
assert len(s)==1
observed={c.name:''.join(gemmi.find_tabulated_residue(r.name).one_letter_code.upper() for r in c if gemmi.find_tabulated_residue(r.name).is_amino_acid()) for c in s[0]}
assert observed==json.load(sys.stdin),'Chain identities differ'
assert all(math.isfinite(v) for c in s[0] for r in c for a in r for v in (a.pos.x,a.pos.y,a.pos.z))
"""
for case in cases:
    item={'case_id':case['case_id'],'reference_id':case['reference_id'],'seed':seed,'phase':'RUNNING','started_at':time.time()}
    try:
        with torch.inference_mode():
            result=builder.fold(model,StructurePredictionInput(sequences=[ProteinInput(id=ch,sequence=seq) for ch,seq in case['chains'].items()]),seed=seed,complex_id=case['case_id'])
        target=output/(case['case_id']+'.cif');temp=target.with_suffix('.cif.partial');temp.write_text(result.complex.to_mmcif())
        audit=subprocess.run([os.environ['CD20_ANALYSIS_PYTHON'],'-c',validation,str(temp)],input=json.dumps(case['chains']),text=True,capture_output=True,timeout=120)
        assert audit.returncode==0,audit.stderr[-2000:]
        scores={'ptm':result.ptm,'iptm':result.iptm,'plddt_mean':float(result.plddt.float().mean().item()),
            'pair_chains_iptm':result.pair_chains_iptm.tolist() if result.pair_chains_iptm is not None else None}
        scorepath=output/(case['case_id']+'.scores.json');scoretemp=scorepath.with_suffix('.json.partial');scoretemp.write_text(json.dumps(scores,indent=2,allow_nan=False)+'\n')
        temp.replace(target);scoretemp.replace(scorepath)
        item.update(phase='PASSED',structure_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),confidence_sha256=hashlib.sha256(scorepath.read_bytes()).hexdigest())
    except Exception as error:item.update(phase='NEEDS_ATTENTION',error=type(error).__name__+': '+str(error))
    item['finished_at']=time.time();records.append(item)
    progress=RUN/'reports'/('esmfold2_seed'+str(seed)+'_progress.json');tmp=progress.with_suffix('.tmp');tmp.write_text(json.dumps(records,indent=2)+'\n');tmp.replace(progress)
    print('ESMFOLD2_CASE',case['case_id'],seed,item['phase'],flush=True)
assert all(x['phase']=='PASSED' for x in records),'Retain partial results and inspect failed cases'
