"""Select source for the first private GitHub snapshot; never copies secrets/audio."""
import json,re
from pathlib import Path
root=Path(__file__).resolve().parents[2]
allowed=['rescue/app','rescue/content','rescue/billing','rescue/audio-reports','rescue/audio/studio','rescue/github-tools']
exclude={'node_modules','private','dist','.git','.astro','.firebase','.wrangler','.venv','__pycache__','rejected','test-results','playwright-report'}
ext={'.ts','.tsx','.astro','.js','.mjs','.cjs','.json','.jsonc','.css','.svg','.html','.py','.sh','.command','.txt','.md','.yaml','.yml','.toml','.rules'}
files=[];flags=[]
pattern=re.compile(r'(?:sk_(?:live|test)_[A-Za-z0-9]{16,}|sk_car_[A-Za-z0-9]{15,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\\n|\n)[A-Za-z0-9/+]{64}|AIza[0-9A-Za-z_-]{30,})')
for base in allowed:
 for p in (root/base).rglob('*'):
  rel=p.relative_to(root)
  if not p.is_file() or p.is_symlink() or any(x in exclude for x in rel.parts):continue
  if p.name.startswith('.env') and p.name!='.env.example':continue
  if p.suffix not in ext and p.name not in {'.gitignore','.firebaserc','.env.example'}:continue
  if p.name.endswith(('.local.json','.log')) or 'conflicted copy' in p.name:continue
  text=p.read_text(errors='replace')
  scan=text.replace("'-----BEGIN PRIVATE KEY-----'", "'KEY_HEADER_VALIDATION'").replace("'-----BEGIN PRIVATE KEY-----\\nOFFLINE FIXTURE\\n-----END PRIVATE KEY-----'", "'OFFLINE_FIXTURE'")
  if pattern.search(scan):flags.append(str(rel))
  files.append(str(rel))
files+=['.gitignore','README.md','rescue/.gitignore','rescue/audio/.gitignore','rescue/qa/legacy-sitemap-paths.json']
Path('/tmp/minimalpairs-source-files.json').write_text(json.dumps(sorted(set(files)),indent=2))
print(json.dumps({'files':len(set(files)),'secretPatternFlags':flags}))
if flags:raise SystemExit(1)
