/**
 * buildJoinUrl deve mettere il nome del partecipante nell'URL del web client.
 *
 * Il contesto e' quello che rende il test necessario: la box e' un kiosk senza
 * tastiera, davanti a una persona anziana. Se il nome non arriva nell'URL, Zoom
 * mostra "Enter Meeting Info" con il campo vuoto e il pulsante Join disabilitato,
 * e nessuno puo' compilarlo — osservato in produzione il 2026-07-29.
 *
 * L'automazione che compila il form resta in joinZoom() come riserva, ma non e'
 * affidabile da sola: Zoom mostra prima "Joining Meeting..." e il form compare
 * dopo, quindi la ricerca del campo puo' arrivare troppo presto.
 */

jest.mock('playwright', () => ({ chromium: { launchPersistentContext: jest.fn() } }));

const { buildJoinUrl, convertToWebClientUrl } = require('../../../src/commands/handlers/zoom');

const WITH_PWD = 'https://us05web.zoom.us/j/123456789?pwd=abc123';
const WITHOUT_PWD = 'https://zoom.us/j/987654321';

describe('buildJoinUrl', () => {
  it('aggiunge uname quando l URL ha gia una query (password)', () => {
    const url = buildJoinUrl(WITH_PWD, 'Lucia Iezzi');

    expect(url).toContain('pwd=abc123');
    expect(url).toContain('uname=Lucia%20Iezzi');
    // La password deve restare: il separatore va scelto in base alla query esistente.
    expect(url).toBe('https://app.zoom.us/wc/123456789/join?pwd=abc123&uname=Lucia%20Iezzi');
  });

  it('apre la query con ? quando l URL non ne ha una', () => {
    const url = buildJoinUrl(WITHOUT_PWD, 'Lucia Iezzi');

    expect(url).toBe('https://app.zoom.us/wc/987654321/join?uname=Lucia%20Iezzi');
    expect(url).not.toContain('?uname=Lucia%20Iezzi&');
    expect(url).not.toContain('join&uname');
  });

  it('codifica i caratteri che romperebbero la query', () => {
    const url = buildJoinUrl(WITH_PWD, 'Anna & Luigi / Rossi?');

    expect(url).toContain('uname=Anna%20%26%20Luigi%20%2F%20Rossi%3F');
    // Il nome non deve introdurre separatori: spezzerebbe pwd o inventerebbe parametri.
    expect(url.split('?')).toHaveLength(2);
    expect(url.match(/&/g)).toHaveLength(1);
  });

  it('non tocca l URL quando il nome manca', () => {
    expect(buildJoinUrl(WITH_PWD, undefined)).toBe(convertToWebClientUrl(WITH_PWD));
    expect(buildJoinUrl(WITH_PWD, '')).toBe(convertToWebClientUrl(WITH_PWD));
  });

  it('propaga l errore su URL non convertibili invece di produrne uno rotto', () => {
    expect(() => buildJoinUrl('https://zoom.us/senza-id', 'Lucia')).toThrow();
  });
});
