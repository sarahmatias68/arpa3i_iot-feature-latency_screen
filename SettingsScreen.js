import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SettingsScreen = ({ navigation, onLogout, themeName = 'dark', onChangeTheme }) => {
  const menuItems = [
    { title: 'Dados do Usuário', screen: 'UserData', icon: 'person-circle-outline' },
    { title: 'Dados do Idoso', screen: 'ElderlyData', icon: 'body-outline' },
    { title: 'Gerenciar Usuários', screen: 'UserList', icon: 'people-outline' },
    { title: 'Dispositivos', screen: 'DeviceRegistry', icon: 'list-outline' },
    { title: 'Sobre o Aplicativo', screen: 'About', icon: 'information-circle-outline' }
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 20 }}>
      <Text style={styles.sectionTitle}>Tema do Aplicativo</Text>
      <View style={styles.themeRow}>
        <TouchableOpacity
          style={[styles.themeButton, themeName === 'light' && styles.themeButtonActive]}
          onPress={() => onChangeTheme && onChangeTheme('light')}
        >
          <Ionicons name="sunny-outline" size={18} color="#f9fafb" style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>Claro</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.themeButton, themeName === 'dark' && styles.themeButtonActive]}
          onPress={() => onChangeTheme && onChangeTheme('dark')}
        >
          <Ionicons name="moon-outline" size={18} color="#f9fafb" style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>Escuro</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.themeButton, themeName === 'amoled' && styles.themeButtonActive]}
          onPress={() => onChangeTheme && onChangeTheme('amoled')}
        >
          <Ionicons name="contrast-outline" size={18} color="#f9fafb" style={{ marginRight: 6 }} />
          <Text style={styles.themeButtonText}>AMOLED</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Configurações</Text>
      {menuItems.map((item, index) => (
        <TouchableOpacity key={index} style={styles.menuItem} onPress={() => navigation.navigate(item.screen)}>
          <Ionicons name={item.icon} size={24} color="#3b82f6" style={styles.icon} />
          <Text style={styles.menuText}>{item.title}</Text>
          <Ionicons name="chevron-forward-outline" size={24} color="#6b7280" />
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={24} color="#ef4444" style={styles.icon} />
          <Text style={styles.logoutText}>Sair</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1220',
    
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '600',
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
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  themeButtonActive: {
    borderColor: '#3b82f6',
  },
  themeButtonText: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '600',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    paddingVertical: 20,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  icon: {
    marginRight: 15,
  },
  menuText: {
    flex: 1,
    color: '#f9fafb',
    fontSize: 18,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    paddingVertical: 20,
    paddingHorizontal: 15,
    marginTop: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#374151',
  },
  logoutText: {
    flex: 1,
    color: '#ef4444',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default SettingsScreen;
