import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useMemo } from 'react';

const API_URL = 'http://192.168.1.2:86';

const getAlertColor = (type) => {
  switch (type) {
    case 'PANICO': return '#ef4444';
    case 'QUEDA': return '#ef4444';
    case 'FUMACA': return '#f97316';
    case 'VAZAMENTO_GAS': return '#eab308';
    case 'WIFI': return '#3b82f6';
    case 'INFO': return '#6b7280';
    default: return '#f9fafb';
  }
};

import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { Picker } from '@react-native-picker/picker';

export default function LogsScreen({ route }) {
  const user = route?.params?.user;

  if (!user) {
    return (
      <View style={styles.container_loader}>
        <ActivityIndicator size="large" color="#f9fafb" />
        <Text style={styles.loader_text}>Carregando dados do usuário...</Text>
      </View>
    );
  }

  const [allAlerts, setAllAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filtros
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState('start');

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/alerts`);

      console.info(response);
      if (!response.ok) throw new Error('Falha na resposta do servidor.');
      const data = await response.json();
      setAllAlerts(data);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível buscar os alertas.');
      setAllAlerts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchAlerts(); }, [fetchAlerts]));

      const handleAcknowledge = async (id) => {
    try {
      const response = await fetch(`${API_URL}/acknowledge`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `id=${id}&user=${user.name}` });
      const result = await response.json();
      if (result.status === 'success') {
        Alert.alert('Sucesso', 'Alerta confirmado.');
        fetchAlerts();
      } else { throw new Error(result.message || 'Falha ao confirmar.'); }
    } catch (error) { Alert.alert('Erro', error.message); }
  };

  const filteredAlerts = useMemo(() => {
    return allAlerts.filter(alert => {
      const statusMatch = statusFilter === 'all' || (statusFilter === 'pending' && !alert.acknowledged_by) || (statusFilter === 'acknowledged' && alert.acknowledged_by);
      const typeMatch = typeFilter === 'all' || alert.alert_type === typeFilter;
      if (!statusMatch || !typeMatch) return false;

      if(startDate || endDate) {
        const alertDate = new Date(alert.timestamp.replace(' ', 'T'));
        if (startDate && alertDate < startDate) return false;
        if (endDate && alertDate > endDate) return false;
      }
      return true;
    });
  }, [allAlerts, statusFilter, typeFilter, startDate, endDate]);

  const showDatePicker = (mode) => { setDatePickerMode(mode); setDatePickerVisibility(true); };
  const hideDatePicker = () => setDatePickerVisibility(false);
  const handleConfirmDate = (date) => {
    if (datePickerMode === 'start') setStartDate(date);
    else setEndDate(date);
    hideDatePicker();
  };

  const clearFilters = () => { setStartDate(null); setEndDate(null); setTypeFilter('all'); };

  const renderItem = ({ item }) => (
    <View style={styles.tableRow}>
      <Text style={[styles.tableCell, styles.typeCell, { color: getAlertColor(item.alert_type) }]}>{item.alert_type}</Text>
      <Text style={[styles.tableCell, styles.messageCell]}>{item.message}</Text>
      <Text style={[styles.tableCell, styles.timestampCell]}>{item.timestamp}</Text>
      <View style={[styles.tableCell, styles.actionCell]}>
        {item.acknowledged_by ? (
          <View style={styles.acknowledgedContainer}><Text style={styles.acknowledgedUser}>{item.acknowledged_by}</Text><Text style={styles.acknowledgedTime}>{item.acknowledged_at}</Text></View>
        ) : (
          <TouchableOpacity style={styles.ackButton} onPress={() => handleAcknowledge(item.id)}><Text style={styles.ackButtonText}>Confirmar</Text></TouchableOpacity>
        )}
      </View>
    </View>
  );

    if (!user) {
    return (
      <View style={styles.container_loader}>
        <ActivityIndicator size="large" color="#f9fafb" />
        <Text style={styles.loader_text}>Carregando dados do usuário...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterContainer}>
        <TouchableOpacity style={[styles.filterButton, statusFilter === 'pending' && styles.activeFilter]} onPress={() => setStatusFilter('pending')}><Text style={styles.filterText}>Pendentes</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterButton, statusFilter === 'acknowledged' && styles.activeFilter]} onPress={() => setStatusFilter('acknowledged')}><Text style={styles.filterText}>Confirmados</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterButton, statusFilter === 'all' && styles.activeFilter]} onPress={() => setStatusFilter('all')}><Text style={styles.filterText}>Todos</Text></TouchableOpacity>
      </View>

      <View style={styles.dateFilterContainer}>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('start')}><Text style={styles.dateButtonText}>{startDate ? startDate.toLocaleDateString() : 'Data Início'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('end')}><Text style={styles.dateButtonText}>{endDate ? endDate.toLocaleDateString() : 'Data Fim'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.clearButton} onPress={clearFilters}><Text style={styles.clearButtonText}>Limpar</Text></TouchableOpacity>
      </View>

      <View style={styles.pickerContainer}>
        <Picker selectedValue={typeFilter} onValueChange={(itemValue) => setTypeFilter(itemValue)} style={styles.picker} dropdownIconColor="#f9fafb">
          <Picker.Item label="Todos os Tipos" value="all" />
          <Picker.Item label="Pânico" value="PANICO" />
          <Picker.Item label="Queda" value="QUEDA" />
          <Picker.Item label="Fumaça" value="FUMACA" />
          <Picker.Item label="Gás" value="VAZAMENTO_GAS" />
          <Picker.Item label="Wi-Fi" value="WIFI" />
          <Picker.Item label="Info" value="INFO" />
        </Picker>
      </View>

      {isLoading ? <ActivityIndicator size="large" color="#f9fafb" style={{ marginTop: 50 }} /> : (
        <>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.typeCell]}>Tipo</Text>
            <Text style={[styles.headerText, styles.messageCell]}>Mensagem</Text>
            <Text style={[styles.headerText, styles.timestampCell]}>Data</Text>
            <Text style={[styles.headerText, styles.actionCell]}>Ação / Usuário</Text>
          </View>
          <FlatList data={filteredAlerts} renderItem={renderItem} keyExtractor={(item) => item.id.toString()} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchAlerts} tintColor="#fff" />} ListEmptyComponent={<Text style={styles.emptyText}>Nenhum alerta encontrado para os filtros selecionados.</Text>} />
        </>
      )}
      <DateTimePickerModal isVisible={isDatePickerVisible} mode="date" onConfirm={handleConfirmDate} onCancel={hideDatePicker} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  filterContainer: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#1f2937', paddingVertical: 10 },
  filterButton: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, backgroundColor: '#374151' },
  activeFilter: { backgroundColor: '#3b82f6' },
  filterText: { color: '#f9fafb', fontWeight: 'bold' },
  dateFilterContainer: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', padding: 10, backgroundColor: '#1f2937', borderTopWidth: 1, borderTopColor: '#374151' },
  dateButton: { backgroundColor: '#374151', padding: 10, borderRadius: 5, flex: 1, marginHorizontal: 5 },
  dateButtonText: { color: '#f9fafb', textAlign: 'center' },
  clearButton: { backgroundColor: '#4b5563', padding: 10, borderRadius: 5 },
  clearButtonText: { color: '#f9fafb' },
  pickerContainer: { backgroundColor: '#1f2937', paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: '#374151' },
  picker: { color: '#f9fafb', height: 50 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#374151', paddingHorizontal: 10, paddingVertical: 12, backgroundColor: '#1f2937' },
  headerText: { color: '#d1d5db', fontWeight: 'bold', fontSize: 14 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#374151' },
  tableCell: { color: '#d1d5db', fontSize: 12 },
  typeCell: { flex: 2, fontWeight: 'bold', textTransform: 'uppercase' },
  messageCell: { flex: 3 },
  timestampCell: { flex: 3 },
  actionCell: { flex: 2, alignItems: 'center' },
  ackButton: { backgroundColor: '#10b981', paddingVertical: 10, paddingHorizontal: 15, borderRadius: 5 },
  ackButtonText: { color: '#fff', fontWeight: 'bold' },
  acknowledgedContainer: { alignItems: 'center' },
  acknowledgedUser: { color: '#10b981', fontWeight: 'bold', fontSize: 14 },
  acknowledgedTime: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  emptyText: { color: '#9ca3af', textAlign: 'center', marginTop: 50 },
  container_loader: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader_text: {
    color: '#f9fafb',
    marginTop: 10,
  },
});
