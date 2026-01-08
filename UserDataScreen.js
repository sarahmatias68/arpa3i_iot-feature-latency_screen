import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { getTheme, typography } from './theme';

const API_URL = 'http://192.168.2.131:86';

const UserDataScreen = ({ user, themeName = 'dark' }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    console.log('Dados do cuidador recebidos na tela Meus Dados:', JSON.stringify(user, null, 2)); // Log para depuração
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  const handleUpdate = async () => {
    if (!name || !email) {
      Alert.alert('Erro', 'Nome e e-mail são obrigatórios.');
      return;
    }
    if (password && password !== confirmPassword) {
      Alert.alert('Erro', 'As novas senhas não coincidem.');
      return;
    }

    // Construir o corpo da requisição, sempre incluindo o campo senha (mesmo que vazio)
    // para corresponder à lógica que funciona na tela de gerenciamento de usuários.
    const body = `id=${user.id}&name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

    try {
      const response = await fetch(`${API_URL}/users/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
      });
      const result = await response.json();
      if (result.status === 'success') {
        Alert.alert('Sucesso', 'Seus dados foram atualizados.');
        // O ideal seria atualizar o estado global do usuário aqui
      } else {
        Alert.alert('Erro', result.message || 'Não foi possível atualizar os dados.');
      }
    } catch (error) {
      Alert.alert('Erro de Conexão', 'Não foi possível se conectar ao servidor.');
    }
  };

  if (!user) {
    return <View style={styles.container}><Text style={styles.infoText}>Carregando...</Text></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardContainer}>
      <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Meus Dados</Text>

      <Text style={styles.label}>Nome</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={theme.colors.muted} />

      <Text style={styles.label}>E-mail</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" placeholderTextColor={theme.colors.muted} />

      <Text style={styles.title}>Alterar Senha</Text>
      <Text style={styles.infoText}>Deixe em branco para não alterar</Text>
      
      <Text style={styles.label}>Nova Senha</Text>
      <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} placeholderTextColor={theme.colors.muted} />

      <Text style={styles.label}>Confirmar Nova Senha</Text>
      <TextInput style={styles.input} secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} placeholderTextColor={theme.colors.muted} />

      <TouchableOpacity style={styles.button} onPress={handleUpdate}>
        <Text style={styles.buttonText}>Salvar Alterações</Text>
      </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme) => StyleSheet.create({
  keyboardContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flexGrow: 1,
    backgroundColor: theme.colors.background,
    padding: 20,
  },
  title: {
    ...typography.h1,
    color: theme.colors.text,
    marginBottom: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  label: {
    ...typography.bodyStrong,
    color: theme.colors.textSecondary,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: theme.colors.card,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoText: {
    ...typography.small,
    color: theme.colors.muted,
    textAlign: 'center',
    marginBottom: 20,
  },
});

export default UserDataScreen;
