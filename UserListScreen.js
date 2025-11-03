import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const API_URL = 'http://192.168.2.115:86';

const UserListScreen = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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
    setModalVisible(true);
  };

  const openModalToEdit = (user) => {
    setCurrentUser(user);
    setName(user.name);
    setEmail(user.email);
    setPassword(''); // A senha não é exibida por segurança
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!name || !email || (!currentUser && !password)) {
      Alert.alert('Erro', 'Preencha todos os campos obrigatórios.');
      return;
    }

    const url = currentUser ? `${API_URL}/users/update` : `${API_URL}/users/add`;
    let body = `id=${currentUser?.id || ''}&name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
    
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
        { text: 'Excluir', style: 'destructive', onPress: async () => {
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
        }},
      ]
    );
  };

  if (loading) {
    return <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.userItem}>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{item.name}</Text>
              <Text style={styles.userEmail}>{item.email}</Text>
            </View>
            <View style={styles.userActions}>
              <TouchableOpacity onPress={() => openModalToEdit(item)}><Ionicons name="pencil" size={24} color="#3b82f6" /></TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(item)} style={{ marginLeft: 20 }} disabled={item.id === 1}>
                <Ionicons name="trash-bin" size={24} color={item.id === 1 ? '#4b5563' : '#ef4444'} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Nenhum usuário cadastrado.</Text>}
      />

      <TouchableOpacity style={styles.fab} onPress={openModalToAdd}>
        <Ionicons name="add" size={30} color="#f9fafb" />
      </TouchableOpacity>

      <Modal animationType="slide" transparent={true} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{currentUser ? 'Editar Usuário' : 'Adicionar Usuário'}</Text>
            
            <TextInput style={styles.input} placeholder="Nome" value={name} onChangeText={setName} placeholderTextColor="#6b7280" />
            <TextInput style={styles.input} placeholder="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor="#6b7280" />
            <TextInput style={styles.input} placeholder={currentUser ? 'Nova Senha (opcional)' : 'Senha'} value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor="#6b7280" />
            
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220' },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111827' },
  userItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#374151', backgroundColor: '#1f2937' },
  userInfo: { flex: 1 },
  userName: { color: '#f9fafb', fontSize: 18, fontWeight: 'bold' },
  userEmail: { color: '#d1d5db', fontSize: 14 },
  userActions: { flexDirection: 'row' },
  emptyText: { textAlign: 'center', color: '#9ca3af', marginTop: 50, fontSize: 16 },
  fab: { position: 'absolute', right: 30, bottom: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: '#2563eb', justifyContent: 'center', alignItems: 'center', elevation: 8 },
  // Modal Styles
  modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalContent: { width: '90%', backgroundColor: '#1f2937', borderRadius: 10, padding: 20, elevation: 10 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#f9fafb', marginBottom: 20, textAlign: 'center' },
  input: { backgroundColor: '#374151', color: '#f9fafb', padding: 12, borderRadius: 8, fontSize: 16, marginBottom: 15 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  button: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#4b5563', marginRight: 10 },
  saveButton: { backgroundColor: '#2563eb', marginLeft: 10 },
  buttonText: { color: '#f9fafb', fontSize: 16, fontWeight: 'bold' },
});

export default UserListScreen;
