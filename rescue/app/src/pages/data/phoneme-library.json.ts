import { getPhonemeLibrary } from '../../lib/phoneme-library';
export const GET = () => new Response(JSON.stringify(getPhonemeLibrary(), null, 2), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex' },
});
