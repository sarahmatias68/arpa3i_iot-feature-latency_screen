import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform } from 'react-native';

const API_URL = 'https://e482f364dbe8.ngrok-free.app'; 

const ForgotPasswordScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handlePasswordReset = async () => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Erro', 'As senhas não coincidem.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/users/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
      });

      const responseJson = await response.json();

      if (responseJson.status === 'success') {
        Alert.alert('Sucesso', 'Sua senha foi alterada! Você já pode fazer o login com a nova senha.');
        navigation.goBack();
      } else {
        Alert.alert('Erro', responseJson.message || 'Não foi possível alterar a senha. Verifique o e-mail informado.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Erro de Conexão', 'Não foi possível se conectar ao servidor.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.inner}>
          <Text style={styles.title}>Redefinir Senha</Text>
          <TextInput
            style={styles.input}
            placeholder="Seu E-mail de Cadastro"
            placeholderTextColor="#888"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Nova Senha"
            placeholderTextColor="#888"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            placeholder="Confirme a Nova Senha"
            placeholderTextColor="#888"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
          <TouchableOpacity style={styles.button} onPress={handlePasswordReset}>
            <Text style={styles.buttonText}>Alterar Senha</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.linkText}>Voltar para o Login</Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    width: '100%',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 40,
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 16,
    color: '#fff',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#007BFF',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  linkText: {
    color: '#007BFF',
    marginTop: 20,
    fontSize: 16,
  },
});

export default ForgotPasswordScreen;
