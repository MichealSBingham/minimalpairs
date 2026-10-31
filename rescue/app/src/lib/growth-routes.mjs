export const challengeSlugs = ['ship-vs-sheep','right-vs-light','thin-vs-sin','tu-vs-tout','banc-vs-bon','poisson-vs-poison'];
export const acquisitionSlugs = ['minimal-pairs-after-fluent-forever','minimal-pairs-without-anki','read-french-but-cant-understand'];
export const growthPaths = [...acquisitionSlugs.map(s=>`/resources/${s}`), ...challengeSlugs.map(s=>`/challenge/${s}`)];
