import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform } from 'react-native';

const API_URL = 'http://192.168.1.3:86';

const LoginScreen = ({ navigation, onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Erro', 'Por favor, preencha o e-mail e a senha.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
      });

      const responseText = await response.text(); // Ler como texto primeiro para depuração
      console.log('Server Response:', responseText); // Log para depuração
      
      if (response.ok) {
        const data = JSON.parse(responseText); // Tentar fazer o parse do JSON
        if (data.status === 'success') {
          onLoginSuccess({ ...data.user }); // Passa apenas o objeto 'user' para o App.js
        } else {
          Alert.alert('Falha no Login', data.message || 'Ocorreu um erro inesperado.');
        }
      } else {
        try {
            const errorData = JSON.parse(responseText);
            Alert.alert('Falha no Login', errorData.message || 'E-mail ou senha inválidos.');
        } catch (e) {
            Alert.alert('Erro no Servidor', `Não foi possível processar a resposta. Status: ${response.status}`);
        }
      }
    } catch (error) {
      console.error('Erro de conexão:', error);
      Alert.alert('Erro de Conexão', 'Não foi possível conectar ao servidor. Verifique o IP e a sua conexão Wi-Fi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.inner}>
      <Image source={require('./assets/Logo (2).png')} style={styles.logo} />
      <TextInput
        style={styles.input}
        placeholder="E-mail"
        placeholderTextColor="#888"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Senha"
        placeholderTextColor="#888"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Entrar</Text>
        )}
      </TouchableOpacity>
      <View style={styles.linksContainer}>
                <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
            <Text style={styles.linkText}>Primeiro Acesso</Text>
        </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
            <Text style={styles.linkText}>Esqueci minha senha</Text>
        </TouchableOpacity>
        </View>
      </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1f2937', // Nova cor de fundo
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logo: {
    width: 300,
    height: 150,
    resizeMode: 'contain',
    marginBottom: 50,
  },
  linksContainer: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginTop: 20,
  },
  linkText: {
    color: '#3b82f6', // Novo azul para links
    fontSize: 16,
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: '#374151', // Nova cor para inputs
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    color: '#f9fafb',
    marginBottom: 15,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#2563eb', // Novo azul para o botão
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default LoginScreen;
