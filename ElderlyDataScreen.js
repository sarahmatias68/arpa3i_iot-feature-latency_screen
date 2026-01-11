import { useMemo, useState, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator, Alert, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTheme, typography } from './theme';

const API_URL = 'http://192.168.2.131:86';

const ElderlyDataScreen = ({ themeName = 'dark' }) => {
  const [elderlyData, setElderlyData] = useState(null);
  const [originalData, setOriginalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('loading'); 
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fetchData = useCallback(async () => {
    setLoading(true);
    setViewMode('loading');
    try {
      const response = await fetch(`${API_URL}/elderly`);
      const data = await response.json();
      if (data && data.id) {
        setElderlyData(data);
        setOriginalData(data);
        setViewMode('display');
      } else {
        setElderlyData({ name: '', age: '', family_contact_name: '', family_contact_phone: '', observations: '' });
        setOriginalData(null);
        setViewMode('empty');
      }
    } catch (error) {
      Alert.alert('Erro de Conexão', 'Não foi possível buscar os dados.');
      setViewMode('empty');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleInputChange = (field, value) => {
    setElderlyData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    const { name, age, family_contact_name, family_contact_phone } = elderlyData;
    if (!name || !age || !family_contact_name || !family_contact_phone) {
      Alert.alert('Campos Obrigatórios', 'Por favor, preencha nome, idade e contato familiar.');
      return;
    }

    const isUpdating = !!elderlyData.id;
    const url = isUpdating ? `${API_URL}/elderly/update` : `${API_URL}/elderly/add`;
    const body = `id=${elderlyData.id || ''}&name=${encodeURIComponent(name)}&age=${age}&family_contact_name=${encodeURIComponent(family_contact_name)}&family_contact_phone=${encodeURIComponent(family_contact_phone)}&observations=${encodeURIComponent(elderlyData.observations || '')}`;

    setLoading(true);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!response.ok) throw new Error('Falha na resposta do servidor.');
      const result = await response.json();
      if (result.status === 'success') {
        Alert.alert('Sucesso', `Dados ${isUpdating ? 'atualizados' : 'salvos'}!`);
        fetchData(); 
      } else {
        throw new Error(result.message || 'Ocorreu um erro no servidor.');
      }
    } catch (error) {
      Alert.alert('Erro ao Salvar', error.message);
      setLoading(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Confirmar Exclusão', 'Tem certeza que deseja excluir os dados do idoso?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => {
        setLoading(true);
        try {
          const response = await fetch(`${API_URL}/elderly/delete`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `id=${elderlyData.id}` });
          const result = await response.json(); // Tenta ler a resposta JSON independentemente do status de 'ok'

          if (response.ok && result.status === 'success') {
            Alert.alert('Sucesso', 'Dados excluídos.');
            fetchData(); // Recarrega e vai para a tela 'empty'
          } else {
            // Se a resposta não for 'ok' ou o status for 'error', usa a mensagem do servidor
            throw new Error(result.message || 'Ocorreu uma falha ao tentar excluir.');
          }
        } catch (error) {
          Alert.alert('Erro ao Excluir', error.message);
        } finally {
          setLoading(false);
        }
      }},
    ]);
  };

  const renderEmptyView = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.title}>Nenhum Idoso Cadastrado</Text>
      <Text style={styles.emptyText}>Adicione os dados para começar o monitoramento.</Text>
      <TouchableOpacity style={styles.button} onPress={() => setViewMode('form')}>
        <Text style={styles.buttonText}>Cadastrar Dados do Idoso</Text>
      </TouchableOpacity>
    </View>
  );

  const renderDisplayView = () => (
    <ScrollView style={styles.contentContainer}>
      <Text style={styles.title}>Dados do Idoso</Text>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Nome:</Text>
        <Text style={styles.cardValue}>{elderlyData.name}</Text>
        <Text style={styles.cardLabel}>Idade:</Text>
        <Text style={styles.cardValue}>{elderlyData.age}</Text>
        <Text style={styles.cardLabel}>Contato Familiar:</Text>
        <Text style={styles.cardValue}>{`${elderlyData.family_contact_name} (${elderlyData.family_contact_phone})`}</Text>
        {elderlyData.observations && (<>
          <Text style={styles.cardLabel}>Observações:</Text>
          <Text style={styles.cardValue}>{elderlyData.observations}</Text>
        </>)}
      </View>
      <TouchableOpacity style={styles.button} onPress={() => setViewMode('form')}>
        <Text style={styles.buttonText}>Editar Dados</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={handleDelete}>
        <Text style={styles.buttonText}>Excluir Cadastro</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderFormView = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <Text style={styles.title}>{elderlyData.id ? 'Editar Dados' : 'Cadastrar Novo Idoso'}</Text>
        <Text style={styles.label}>Nome Completo</Text>
        <TextInput style={styles.input} value={elderlyData.name} onChangeText={(text) => handleInputChange('name', text)} placeholder="Nome do idoso" placeholderTextColor="#6b7280" />
        <Text style={styles.label}>Idade</Text>
        <TextInput style={styles.input} value={String(elderlyData.age)} onChangeText={(text) => handleInputChange('age', text)} placeholder="Idade" placeholderTextColor="#6b7280" keyboardType="numeric" />
        <Text style={styles.label}>Nome do Contato Familiar</Text>
        <TextInput style={styles.input} value={elderlyData.family_contact_name} onChangeText={(text) => handleInputChange('family_contact_name', text)} placeholder="Nome do familiar" placeholderTextColor="#6b7280" />
        <Text style={styles.label}>Telefone do Contato Familiar</Text>
        <TextInput style={styles.input} value={elderlyData.family_contact_phone} onChangeText={(text) => handleInputChange('family_contact_phone', text)} placeholder="(XX) XXXXX-XXXX" placeholderTextColor="#6b7280" keyboardType="phone-pad" />
        <Text style={styles.label}>Observações Médicas e Gerais</Text>
        <TextInput style={[styles.input, styles.textArea]} value={elderlyData.observations} onChangeText={(text) => handleInputChange('observations', text)} placeholder="Alergias, medicamentos..." placeholderTextColor="#6b7280" multiline />
        <TouchableOpacity style={styles.button} onPress={handleSave}>
          <Text style={styles.buttonText}>Salvar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={() => originalData ? setViewMode('display') : setViewMode('empty') }>
          <Text style={styles.buttonText}>Cancelar</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    <View style={styles.container}>
      {viewMode === 'display' && renderDisplayView()}
      {viewMode === 'form' && renderFormView()}
      {viewMode === 'empty' && renderEmptyView()}
    </View>
  );
};

const createStyles = (theme) => StyleSheet.create({
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    ...typography.body,
    color: theme.colors.muted,
    textAlign: 'center',
    marginBottom: 20,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardLabel: {
    ...typography.smallStrong,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  cardValue: {
    ...typography.body,
    color: theme.colors.text,
    marginBottom: 16,
  },
  cancelButton: {
    backgroundColor: theme.colors.border,
    marginTop: 15,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    padding: 20,
    backgroundColor: theme.colors.background,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  title: {
    ...typography.h1,
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  label: {
    ...typography.bodyStrong,
    color: theme.colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: theme.colors.primary,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  deleteButton: {
    backgroundColor: theme.colors.danger,
    marginTop: 15,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default ElderlyDataScreen;
