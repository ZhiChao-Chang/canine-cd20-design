"""Seed the unmodified upstream single-process BoltzGen pipeline."""
from pathlib import Path
import os
import random
import runpy
import sys
import numpy as np
import torch
from pytorch_lightning import seed_everything

seed = int(os.environ.get('CD20_DESIGN_SEED', '42'))
seed_everything(seed, workers=True)
random.seed(seed)
np.random.seed(seed)
torch.manual_seed(seed)
torch.cuda.manual_seed_all(seed)
assert '--no_subprocess' in sys.argv, 'Child processes must not bypass explicit seeding'
sys.argv[0] = 'boltzgen'
runpy.run_path(str(Path(sys.prefix) / 'bin/boltzgen'), run_name='__main__')
