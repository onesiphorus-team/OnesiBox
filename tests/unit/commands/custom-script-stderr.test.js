const { ultimaRigaUtile } = require('../../../src/commands/handlers/custom-script');

// Il motivo del fallimento (es. "TV non raggiungibile") arriva al server e su
// Telegram: va estratto dallo stderr dello script.
describe('ultimaRigaUtile', () => {
  it('keeps the last non-empty line of stderr', () => {
    expect(ultimaRigaUtile('[discover-tv] scansione...\n[to-box] TV non raggiungibile\n\n')).toBe('[to-box] TV non raggiungibile');
    expect(ultimaRigaUtile(Buffer.from('riga 1\r\nriga 2\r\n'))).toBe('riga 2');
  });

  it('returns an empty string when there is nothing to say', () => {
    expect(ultimaRigaUtile(undefined)).toBe('');
    expect(ultimaRigaUtile('  \n ')).toBe('');
  });

  it('shortens very long lines', () => {
    const riga = ultimaRigaUtile('x'.repeat(500));
    expect(riga).toHaveLength(200);
    expect(riga.endsWith('...')).toBe(true);
  });
});
