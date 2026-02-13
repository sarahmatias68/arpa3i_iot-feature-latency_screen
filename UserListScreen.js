import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getTheme, typography } from './theme';

const API_URL = 'https://painel.arpa3i.me';

const UserListScreen = ({ themeName = 'dark' }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('pending');
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/users`);
      const json = await response.json();
      setUsers(json);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível buscar os usuários.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchUsers();
    }, [fetchUsers])
  );

  const openModalToAdd = () => {
    setCurrentUser(null);
    setName('');
    setEmail('');
    setPassword('');
    setRole('pending'); // Padrão para novos
    setModalVisible(true);
  };

  const openModalToEdit = (user) => {
    setCurrentUser(user);
    setName(user.name);
    setEmail(user.email);
    setPassword(''); // A senha não é exibida por segurança
    // --- [NOVO V51] Carrega o papel atual ---
    setRole(user.role || 'pending');
    // ---------------------------------------
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!name || !email || (!currentUser && !password)) {
      Alert.alert('Erro', 'Preencha todos os campos obrigatórios.');
      return;
    }

    const url = currentUser ? `${API_URL}/users/update` : `${API_URL}/users/add`;
    let body = `id=${currentUser?.id || ''}&name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&role=${encodeURIComponent(role)}`;

    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const result = await response.json();
      if (result.status === 'success') {
        Alert.alert('Sucesso', `Usuário ${currentUser ? 'atualizado' : 'adicionado'} com sucesso!`);
        setModalVisible(false);
        fetchUsers();
      } else {
        throw new Error(result.message || 'Falha ao salvar');
      }
    } catch (error) {
      Alert.alert('Erro', error.message);
    }
  };

  const handleDelete = (user) => {
    if (user.id === 1) {
      Alert.alert('Ação Proibida', 'O usuário administrador não pode ser excluído.');
      return;
    }

    Alert.alert(
      'Confirmar Exclusão',
      `Tem certeza que deseja excluir o usuário ${user.name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir', style: 'destructive', onPress: async () => {
            try {
              const response = await fetch(`${API_URL}/users/delete`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `id=${user.id}` });
              const result = await response.json();
              if (result.status === 'success') {
                Alert.alert('Sucesso', 'Usuário excluído.');
                fetchUsers();
              } else {
                throw new Error(result.message || 'Falha ao excluir');
              }
            } catch (error) {
              Alert.alert('Erro', error.message || 'Não foi possível excluir o usuário.');
            }
          }
        },
      ]
    );
  };

  if (loading) {
    return <ActivityIndicator size="large" color={theme.colors.primary} style={styles.loader} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.userItem}>
            <View style={styles.userInfo}>
              {/* --- [CORREÇÃO DE LAYOUT] Container Row para Nome + Badge --- */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={styles.userName}>{item.name}</Text>

                {/* Badges de Papel */}
                {item.role === 'admin' && <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}><Text style={styles.badgeText}>ADMIN</Text></View>}
                {item.role === 'caregiver' && <View style={[styles.badge, { backgroundColor: '#10b981' }]}><Text style={styles.badgeText}>CUIDADOR</Text></View>}
                {item.role === 'elderly' && <View style={[styles.badge, { backgroundColor: '#f59e0b' }]}><Text style={styles.badgeText}>IDOSO</Text></View>}
                {(item.role === 'pending' || !item.role) && <View style={[styles.badge, { backgroundColor: '#6b7280' }]}><Text style={styles.badgeText}>PENDENTE</Text></View>}
              </View>
              {/* ----------------------------------------------------------- */}

              <Text style={styles.userEmail}>{item.email}</Text>
            </View>
            <View style={styles.userActions}>
              <TouchableOpacity onPress={() => openModalToEdit(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="pencil" size={24} color={theme.colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(item)} style={{ marginLeft: 20 }} disabled={item.id === 1} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="trash-bin" size={24} color={item.id === 1 ? theme.colors.muted : theme.colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Nenhum usuário cadastrado.</Text>}
      />

      <TouchableOpacity style={styles.fab} onPress={openModalToAdd}>
        <Ionicons name="add" size={30} color={theme.colors.text} />
      </TouchableOpacity>

      <Modal animationType="slide" transparent={true} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{currentUser ? 'Editar Usuário' : 'Adicionar Usuário'}</Text>

            <TextInput style={styles.input} placeholder="Nome" value={name} onChangeText={setName} placeholderTextColor={theme.colors.muted} />
            <TextInput style={styles.input} placeholder="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor={theme.colors.muted} />
            <TextInput style={styles.input} placeholder={currentUser ? 'Nova Senha (opcional)' : 'Senha'} value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={theme.colors.muted} />
            {/* --- [NOVO V51] Seletor de Papel (Radio Buttons Simplificados) --- */}
            <Text style={{ color: theme.colors.text, marginBottom: 10, fontWeight: 'bold' }}>Permissão de Acesso:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {['admin', 'caregiver', 'elderly', 'pending'].map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRole(r)}
                  style={[
                    styles.roleButton,
                    role === r && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }
                  ]}
                >
                  <Text style={[
                    styles.roleButtonText,
                    role === r && { color: '#fff' }
                  ]}>
                    {r === 'admin' ? 'Admin' : r === 'caregiver' ? 'Cuidador' : r === 'elderly' ? 'Idoso' : 'Pendente'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* --------------------------------------------------------------- */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={() => setModalVisible(false)}><Text style={styles.buttonText}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={handleSave}><Text style={styles.buttonText}>Salvar</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },
  userItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.card },
  userInfo: { flex: 1 },
  userName: { ...typography.h3, color: theme.colors.text },
  userEmail: { ...typography.small, color: theme.colors.muted },
  userActions: { flexDirection: 'row' },
  emptyText: { textAlign: 'center', color: theme.colors.muted, marginTop: 50, ...typography.body },
  fab: { position: 'absolute', right: 30, bottom: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 8 },
  // Modal Styles
  modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalContent: { width: '90%', backgroundColor: theme.colors.card, borderRadius: 10, padding: 20, elevation: 10, borderWidth: 1, borderColor: theme.colors.border },
  modalTitle: { ...typography.h2, color: theme.colors.text, marginBottom: 20, textAlign: 'center' },
  input: { backgroundColor: theme.colors.card, color: theme.colors.text, padding: 12, borderRadius: 8, fontSize: 16, marginBottom: 15, borderWidth: 1, borderColor: theme.colors.border },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  button: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: theme.colors.border, marginRight: 10 },
  saveButton: { backgroundColor: theme.colors.primary, marginLeft: 10 },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: 'bold' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  roleButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'transparent',
  },
  roleButtonText: {
    fontSize: 12,
    color: theme.colors.text,
  }
});

export default UserListScreen;
