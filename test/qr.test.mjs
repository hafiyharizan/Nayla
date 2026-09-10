/* The QR encoder is verified by round-trip: encode, render to an image, and
 * decode it with a real scanner (zxing, the same engine behind most phone
 * camera apps). That is the contract that matters — a matrix that decodes is
 * correct, whatever cosmetic choices it makes.
 *
 * Byte-comparing against another encoder is deliberately NOT the test: the
 * spec leaves room for legal variation (error-correction boosting, padding of
 * the final codeword, mask tie-breaks) and segno and zxing disagree with each
 * other as readily as with us.
 *
 * Run:  python3 test/qr_roundtrip.py
 * This file exists to point you there, and to fail loudly in npm test if the
 * decoder isn't installed.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
try {
  execFileSync('python3', ['-c', 'import zxingcpp, PIL'], { stdio: 'ignore' });
} catch {
  console.log('SKIP — QR round-trip needs: pip install zxing-cpp pillow');
  process.exit(0);
}
const out = execFileSync('python3', [join(here, 'qr_roundtrip.py')], { encoding: 'utf8' });
process.stdout.write(out);
