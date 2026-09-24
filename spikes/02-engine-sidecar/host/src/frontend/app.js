// PROTOTYPE — show the host's log lines as they arrive.
const el = document.getElementById('log');
const add = (line) => {
  const s = document.createElement('div');
  if (line.includes('PASS')) s.className = 'pass';
  if (line.includes('FAIL')) s.className = 'fail';
  s.textContent = line;
  el.appendChild(s);
};
tiny.api.on('log', add);
tiny.api.call('history').then((lines) => lines.forEach(add));
