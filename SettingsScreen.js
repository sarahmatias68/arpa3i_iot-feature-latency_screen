import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert } from 'react-native';
import { useMemo, useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { getTheme, typography } from './theme';
import { useAlerts } from './AlertsContext';

const SettingsScreen = ({ navigation, onLogout, themeName = 'dark', onChangeTheme }) => {
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { serverIp, serverPort, updateServerConfig, connectionStatus } = useAlerts();
  const [ipInput, setIpInput] = useState('');
  const [portInput, setPortInput] = useState('');

  useEffect(() => {
    setIpInput(serverIp || '');
    setPortInput(String(serverPort || 86));
  }, [serverIp, serverPort]);

  const saveServerEndpoint = async () => {
    const ip = (ipInput || '').trim();
    const port = Number(portInput) || 86;
    if (!ip) {
      Alert.alert('IP inválido', 'Digite um endereço IP válido do servidor ESP.');
      return;
    }
    await updateServerConfig(ip, port);
    Alert.alert('Configuração salva', `Servidor definido para ${ip}:${port}. Estado: ${connectionStatus}`);
  };
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

      <Text style={styles.sectionTitle}>Servidor ESP</Text>
      <View style={styles.serverBox}>
        <Text style={styles.label}>Endereço IP</Text>
        <TextInput
          style={styles.input}
          placeholder="ex: 192.168.0.100"
          placeholderTextColor={theme.colors.muted}
          value={ipInput}
          onChangeText={setIpInput}
          autoCapitalize="none"
        />
        <Text style={styles.label}>Porta</Text>
        <TextInput
          style={styles.input}
          placeholder="ex: 86"
          placeholderTextColor={theme.colors.muted}
          value={portInput}
          onChangeText={setPortInput}
          keyboardType="numeric"
        />
        <TouchableOpacity style={styles.saveButton} onPress={saveServerEndpoint}>
          <Ionicons name="save-outline" size={18} color={theme.colors.text} style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>Salvar e Reconectar</Text>
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
  serverBox: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    marginHorizontal: 15,
    padding: 12,
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
  label: {
    ...typography.smallStrong,
    color: theme.colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    height: 44,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    color: theme.colors.text,
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
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
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
