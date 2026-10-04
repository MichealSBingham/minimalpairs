import fs from 'node:fs';
import path from 'node:path';

export const GET = () => {
  const snapshot = fs.readFileSync(path.resolve(process.cwd(), '../content/phoneme-research/releases/text-bank-v2.json'), 'utf8');
  const value = JSON.parse(snapshot);
  if (value.release?.id !== 'text-bank-v2' || value.release.libraryFingerprint !== value.fingerprint) throw new Error('Invalid archived text bank');
  return new Response(snapshot, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
};
