const {
  DISABLED_FEATURES,
  NO_KEYRING_ARGS,
  COMMON_ARGS,
  WAYLAND_ARGS,
} = require('../../../src/browser/chromium-args');

/** Estrae i valori di uno switch --nome=valore da una lista di argomenti. */
function switchValues(args, name) {
  return args
    .filter((arg) => arg.startsWith(`--${name}=`))
    .map((arg) => arg.slice(`--${name}=`.length));
}

describe('chromium-args', () => {
  describe('--disable-features', () => {
    it('compare una sola volta negli argomenti comuni', () => {
      // Chromium tiene solo l'ultima occorrenza di uno switch duplicato:
      // due --disable-features nello stesso processo ne annullano uno.
      expect(switchValues(COMMON_ARGS, 'disable-features')).toHaveLength(1);
    });

    it('disattiva la traduzione automatica', () => {
      const [value] = switchValues(COMMON_ARGS, 'disable-features');
      expect(value.split(',')).toEqual(expect.arrayContaining(['Translate', 'TranslateUI']));
    });

    it('non compare anche negli argomenti Wayland', () => {
      const combined = [...COMMON_ARGS, ...WAYLAND_ARGS];
      expect(switchValues(combined, 'disable-features')).toHaveLength(1);
    });
  });

  describe('--enable-features', () => {
    it('compare una sola volta unendo argomenti comuni e Wayland', () => {
      const combined = [...COMMON_ARGS, ...WAYLAND_ARGS];
      expect(switchValues(combined, 'enable-features')).toHaveLength(1);
    });

    it('abilita Ozone su Wayland', () => {
      const [value] = switchValues(WAYLAND_ARGS, 'enable-features');
      expect(value.split(',')).toContain('UseOzonePlatform');
    });
  });

  describe('keyring', () => {
    it('forza il password store "basic" invece di gnome-keyring', () => {
      expect(NO_KEYRING_ARGS).toContain('--password-store=basic');
      expect(COMMON_ARGS).toContain('--password-store=basic');
    });

    it('non lascia --password-store duplicato con valori diversi', () => {
      const values = new Set(switchValues(COMMON_ARGS, 'password-store'));
      expect(values.size).toBe(1);
    });
  });

  it('DISABLED_FEATURES non contiene voci vuote o duplicate', () => {
    expect(DISABLED_FEATURES.every((f) => f.length > 0)).toBe(true);
    expect(new Set(DISABLED_FEATURES).size).toBe(DISABLED_FEATURES.length);
  });
});
