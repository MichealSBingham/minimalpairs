#!/bin/zsh
cd "${0:A:h}"
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
../.venv/bin/python -u audit_layer2.py 2>&1 | tee -a private/layer2-run.log
exit ${pipestatus[1]}
