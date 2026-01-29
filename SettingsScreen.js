import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { getTheme, typography } from './theme';

const SettingsScreen = ({ navigation, onLogout, themeName = 'dark', onChangeTheme, appMode, onChangeAppMode }) => {
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const menuItems = [
    { title: 'Dados do Cuidador', screen: 'UserData', icon: 'person-circle-outline' },
    { title: 'Dados do Idoso', screen: 'ElderlyData', icon: 'body-outline' },
    { title: 'Gerenciar Usuários', screen: 'UserList', icon: 'people-outline' },
    { title: 'Dispositivos', screen: 'DeviceRegistry', icon: 'list-outline' },
    { title: 'Histórico de Alertas', screen: 'Logs', icon: 'file-tray-full-outline' },
    { title: 'Sobre o Aplicativo', screen: 'About', icon: 'information-circle-outline' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 20 }}>
      <Text style={styles.sectionTitle}>Tema do Aplicativo</Text>
      <View style={styles.themeRow}>
        <TouchableOpacity
          style={[styles.themeButton, themeName === 'light' && styles.themeButtonActive]}
          onPress={() => onChangeTheme && onChangeTheme('light')}
        >
          <Ionicons name="sunny-outline" size={18} color={themeName === 'light' ? theme.colors.text : theme.colors.textSecondary} style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>Claro</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.themeButton, themeName === 'dark' && styles.themeButtonActive]}
          onPress={() => onChangeTheme && onChangeTheme('dark')}
        >
          <Ionicons name="moon-outline" size={18} color={themeName === 'dark' ? theme.colors.text : theme.colors.textSecondary} style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>Escuro</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Modo de Exibição</Text>
      <View style={styles.themeRow}>
        <TouchableOpacity
          style={[styles.themeButton, appMode === 'admin' && styles.themeButtonActive]}
          onPress={() => onChangeAppMode && onChangeAppMode('admin')}
        >
          <Ionicons name="construct-outline" size={18} color={appMode === 'admin' ? theme.colors.text : theme.colors.textSecondary} style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>ADMIN</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.themeButton, appMode === 'elderly' && styles.themeButtonActive]}
          onPress={() => onChangeAppMode && onChangeAppMode('elderly')}
        >
          <Ionicons name="body-outline" size={18} color={appMode === 'elderly' ? theme.colors.text : theme.colors.textSecondary} style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>ELDERLY</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Configurações</Text>
      {menuItems.map((item, index) => (
        <TouchableOpacity key={index} style={styles.menuItem} onPress={() => navigation.navigate(item.screen)}>
          <Ionicons name={item.icon} size={24} color={theme.colors.primary} style={styles.icon} />
          <Text style={styles.menuText}>{item.title}</Text>
          <Ionicons name="chevron-forward-outline" size={24} color={theme.colors.muted} />
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={24} color={theme.colors.danger} style={styles.icon} />
          <Text style={styles.logoutText}>Sair</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  sectionTitle: {
    ...typography.smallStrong,
    color: theme.colors.textSecondary,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 15,
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    marginBottom: 10,
  },
  themeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  themeButtonActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.name === 'light' ? '#dbeafe' : '#1e3a8a',
  },
  themeButtonText: {
    ...typography.smallStrong,
    color: theme.colors.text,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    paddingVertical: 20,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  icon: {
    marginRight: 15,
  },
  menuText: {
    flex: 1,
    ...typography.h3,
    color: theme.colors.text,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    paddingVertical: 20,
    paddingHorizontal: 15,
    marginTop: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  logoutText: {
    flex: 1,
    ...typography.h3,
    color: theme.colors.danger,
  },
});

export default SettingsScreen;
