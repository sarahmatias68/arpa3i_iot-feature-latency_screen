// Centralized theme constants for ARPA3I app
// Light and Dark variants

export const THEMES = {
  light: {
    name: 'light',
    colors: {
      background: '#bdbdbd',
      card: '#e8e8e8',
      border: '#e5e7eb',
      text: '#111827',
      textSecondary: '#111827',
      muted: '#111827',
      primary: '#2563eb',
      danger: '#ef4444',
      warning: '#f59e0b',
      success: '#10b981',
      overlay: 'rgba(0,0,0,0.5)'
    }
  },
  dark: {
    name: 'dark',
    colors: {
      background: '#0b1220',
      card: '#1f2937',
      border: '#374151',
      text: '#f9fafb',
      textSecondary: '#e5e7eb',
      muted: '#9ca3af',
      primary: '#2563eb',
      danger: '#ef4444',
      warning: '#f59e0b',
      success: '#10b981',
      overlay: 'rgba(0,0,0,0.5)'
    }
  }
};

export function getTheme(name) {
  if (name === 'light') return THEMES.light;
  return THEMES.dark;
}

export const typography = {
  // Titles
  h1: { fontSize: 24, fontWeight: 'bold' },
  h2: { fontSize: 20, fontWeight: 'bold' },
  h3: { fontSize: 18, fontWeight: '700' },
  // Body
  body: { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 14, fontWeight: '400' },
  smallStrong: { fontSize: 14, fontWeight: '600' },
};

// Example helper to merge color/style quickly in components
export function themedStyles(theme) {
  const { colors } = getTheme(theme);
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    card: { backgroundColor: colors.card, borderColor: colors.border },
    title: { color: colors.text, ...typography.h1 },
    subtitle: { color: colors.textSecondary, ...typography.h3 },
    text: { color: colors.text, ...typography.body },
    textMuted: { color: colors.muted, ...typography.small },
    buttonPrimary: { backgroundColor: colors.primary },
    buttonDanger: { backgroundColor: colors.danger },
  };
}
