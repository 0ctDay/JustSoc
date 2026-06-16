
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  const msg = JSON.parse(line);
  console.log('Received:', msg.method);
  if (msg.method === 'test') {
    try {
      const r = await fetch('http://elasticsearch:9200/');
      const t = await r.text();
      console.log('FETCH OK:', t.slice(0,50));
    } catch(e) {
      console.error('FETCH ERROR:', e.message, e.cause?.message);
    }
  }
});
rl.on('close', () => process.exit(0));
