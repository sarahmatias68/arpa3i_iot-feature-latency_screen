import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const PermissionsScreen = () => {
  return (
    <View style={styles.container}>
      <Ionicons name="lock-closed-outline" size={80} color="#f59e0b" />
      <Text style={styles.title}>Gerenciamento de Permissões</Text>
      <Text style={styles.text}>
        Esta área permitirá definir diferentes níveis de acesso para os usuários (ex: Administrador, Cuidador, Familiar), controlando quem pode visualizar relatórios, confirmar alertas ou alterar configurações.
      </Text>
      <Text style={styles.subText}>
        (Funcionalidade a ser implementada futuramente)
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111827', padding: 20 },
  title: { color: '#f9fafb', fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 10, textAlign: 'center' },
  text: { color: '#d1d5db', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  subText: { color: '#6b7280', fontSize: 14, textAlign: 'center' },
});

export default PermissionsScreen;
