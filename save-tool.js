// GachAlexia save decoder/encoder — for the owner only~
// Usage:
//   node save-tool.js decode <input.alexia> [output.json]
//   node save-tool.js encode <input.json>   [output.alexia]
//
// decode: obfuscated .alexia save → pretty-printed editable JSON
// encode: edited JSON → obfuscated .alexia save ready to import

const fs = require('fs');
const path = require('path');

const SAVE_PREFIX = 'GACHALEXIA1:';
const SAVE_KEY = [0x41, 0x6c, 0x65, 0x78, 0x69, 0x61, 0x47, 0x61,
                  0x63, 0x68, 0x61, 0x53, 0x61, 0x76, 0x65, 0x21];

function deobfuscate(text) {
  const t = text.trim();
  if (!t.startsWith(SAVE_PREFIX)) return t;  // already plain JSON
  const bin = Buffer.from(t.slice(SAVE_PREFIX.length), 'base64');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin[i] ^ SAVE_KEY[i % SAVE_KEY.length];
  return new TextDecoder().decode(bytes);
}

function obfuscate(plainText) {
  const bytes = new TextEncoder().encode(plainText);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= SAVE_KEY[i % SAVE_KEY.length];
  return SAVE_PREFIX + Buffer.from(bytes).toString('base64');
}

const [,, cmd, input, output] = process.argv;

if (!cmd || !input || !['decode', 'encode'].includes(cmd)) {
  console.log('Usage:');
  console.log('  node save-tool.js decode <input.alexia> [output.json]');
  console.log('  node save-tool.js encode <input.json>   [output.alexia]');
  process.exit(1);
}

const raw = fs.readFileSync(input, 'utf8');

if (cmd === 'decode') {
  const plain = deobfuscate(raw);
  let pretty;
  try { pretty = JSON.stringify(JSON.parse(plain), null, 2); }
  catch (e) { console.error('Decoded content is not valid JSON — file may be corrupt.'); process.exit(1); }
  const out = output || input.replace(/\.alexia$/i, '') + '.decoded.json';
  fs.writeFileSync(out, pretty);
  console.log(`decoded → ${out}`);
} else {
  let parsed;
  try { parsed = JSON.parse(deobfuscate(raw)); }  // accept plain or already-obfuscated input
  catch (e) { console.error('Input is not valid JSON.'); process.exit(1); }
  const out = output || input.replace(/\.(decoded\.)?json$/i, '') + '.alexia';
  fs.writeFileSync(out, obfuscate(JSON.stringify(parsed)));
  console.log(`encoded → ${out}`);
}
