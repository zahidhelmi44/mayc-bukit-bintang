// Read from a hidden terminal prompt (or stdin pipe); write only a salted hash.
import { passwordHash } from '../engagement-api/src/security.mjs';
async function hidden(prompt) {
  process.stderr.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const receive = chunk => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') { finish(); reject(new Error('Cancelled')); return; }
        if (ch === '\r' || ch === '\n') { finish(); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    function finish() { process.stdin.off('data', receive); process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n'); }
    process.stdin.on('data', receive);
  });
}
try {
  let password;
  if (process.stdin.isTTY) {
    password = await hidden('New admin password (at least 16 characters): ');
    if (password !== await hidden('Repeat password: ')) throw new Error('Passwords do not match.');
  } else {
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  if (password.length < 16 || password.length > 256) throw new Error('Use a password between 16 and 256 characters.');
  process.stdout.write(await passwordHash(password) + '\n');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
