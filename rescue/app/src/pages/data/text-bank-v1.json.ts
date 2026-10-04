import fs from 'node:fs';
import path from 'node:path';

// This archive stays independent of subsequent editable research packs.
export const GET = () => {
  const snapshot = fs.readFileSync(path.resolve(process.cwd(), '../content/phoneme-research/releases/text-bank-v1.json'), 'utf8');
  const value = JSON.parse(snapshot);
  if (value.release?.id !== 'text-bank-v1' || value.release.libraryFingerprint !== value.fingerprint) throw new Error('Invalid archived text bank');
  return new Response(snapshot, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
};
