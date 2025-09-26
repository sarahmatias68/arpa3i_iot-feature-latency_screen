import { Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SettingsScreen = ({ navigation, onLogout }) => {
  const menuItems = [
    { title: 'Dados do Usuário', screen: 'UserData', icon: 'person-circle-outline' },
    { title: 'Dados do Idoso', screen: 'ElderlyData', icon: 'body-outline' },
    { title: 'Gerenciar Usuários', screen: 'UserList', icon: 'people-outline' },
    { title: 'Permissões', screen: 'Permissions', icon: 'lock-closed-outline' },
    { title: 'Sobre o Aplicativo', screen: 'About', icon: 'information-circle-outline' },
    // { title: 'Métricas de Desempenho', screen: 'Metrics', icon: 'stats-chart-outline' },
  ];

  return (
    <ScrollView style={styles.container}>
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
    backgroundColor: '#111827',
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
