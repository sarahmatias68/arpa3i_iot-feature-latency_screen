import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { getTheme, typography } from './theme';

const SettingsScreen = ({ navigation, route, onLogout, themeName = 'dark', onChangeTheme }) => {
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const user = route.params?.user;
  const isAdmin = user?.role === 'admin';
  const allMenuItems = [
    { title: 'Dados do Cuidador', screen: 'UserData', icon: 'person-circle-outline', role: 'all' },
    { title: 'Dados do Idoso', screen: 'ElderlyData', icon: 'body-outline', role: 'all' },
    { title: 'Gerenciar Usuários', screen: 'UserList', icon: 'people-outline', role: 'admin' },
    { title: 'Dispositivos', screen: 'DeviceRegistry', icon: 'list-outline', role: 'admin' },
    { title: 'Histórico de Alertas', screen: 'Logs', icon: 'file-tray-full-outline', role: 'admin' },
    { title: 'Sobre o Aplicativo', screen: 'About', icon: 'information-circle-outline', role: 'all' },
  ];
  const menuItems = allMenuItems.filter(item => isAdmin || item.role === 'all');
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
