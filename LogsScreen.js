import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Alert, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTheme, typography } from './theme';

const API_URL = 'http://192.168.1.8:86';

const getAlertColor = (type, theme) => {
  switch (type) {
    case 'PANICO': return '#ef4444';
    case 'QUEDA': return '#ef4444';
    case 'FUMACA': return '#f97316';
    case 'VAZAMENTO_GAS': return '#eab308';
    case 'WIFI': return '#3b82f6';
    case 'INFO': return '#6b7280';
    default: return theme.colors.text;
  }
};

import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { Picker } from '@react-native-picker/picker';

export default function LogsScreen({ route, user, themeName = 'dark' }) {

  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!user) {
    return (
      <View style={styles.container_loader}>
        <ActivityIndicator size="large" color={theme.colors.text} />
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
      <Text style={[styles.tableCell, styles.typeCell, { color: getAlertColor(item.alert_type, theme) }]}>{item.alert_type}</Text>
      <Text style={[styles.tableCell, styles.messageCell]}>{item.message}</Text>
      <Text style={[styles.tableCell, styles.timestampCell]}>{item.timestamp}</Text>
    </View>
  );



  return (
    <View style={styles.container}>
      <View style={styles.filterContainer}>
        <TouchableOpacity style={[styles.filterButton, statusFilter === 'pending' && styles.activeFilter]} onPress={() => setStatusFilter('pending')}>
          <Text style={[styles.filterText, statusFilter === 'pending' && styles.activeFilterText]}>Pendentes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterButton, statusFilter === 'acknowledged' && styles.activeFilter]} onPress={() => setStatusFilter('acknowledged')}>
          <Text style={[styles.filterText, statusFilter === 'acknowledged' && styles.activeFilterText]}>Confirmados</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterButton, statusFilter === 'all' && styles.activeFilter]} onPress={() => setStatusFilter('all')}>
          <Text style={[styles.filterText, statusFilter === 'all' && styles.activeFilterText]}>Todos</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dateFilterContainer}>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('start')}><Text style={styles.dateButtonText}>{startDate ? startDate.toLocaleDateString() : 'Data Início'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('end')}><Text style={styles.dateButtonText}>{endDate ? endDate.toLocaleDateString() : 'Data Fim'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.clearButton} onPress={clearFilters}><Text style={styles.clearButtonText}>Limpar</Text></TouchableOpacity>
      </View>

      <View style={styles.pickerContainer}>
        <Picker selectedValue={typeFilter} onValueChange={(itemValue) => setTypeFilter(itemValue)} style={styles.picker} dropdownIconColor={theme.colors.text}>
          <Picker.Item label="Todos os Tipos" value="all" />
          <Picker.Item label="Pânico" value="PANICO" />
          <Picker.Item label="Queda" value="QUEDA" />
          <Picker.Item label="Fumaça" value="FUMACA" />
          <Picker.Item label="Gás" value="VAZAMENTO_GAS" />
          <Picker.Item label="Wi-Fi" value="WIFI" />
          <Picker.Item label="Info" value="INFO" />
        </Picker>
      </View>

      {isLoading ? <ActivityIndicator size="large" color={theme.colors.text} style={{ marginTop: 50 }} /> : (
        <>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.typeCell]}>Tipo</Text>
            <Text style={[styles.headerText, styles.messageCell]}>Mensagem</Text>
            <Text style={[styles.headerText, styles.timestampCell]}>Data</Text>
          </View>
          <FlatList data={filteredAlerts} renderItem={renderItem} keyExtractor={(item) => item.id.toString()} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchAlerts} tintColor={theme.colors.text} />} ListEmptyComponent={<Text style={styles.emptyText}>Nenhum alerta encontrado para os filtros selecionados.</Text>} />
        </>
      )}
      <DateTimePickerModal isVisible={isDatePickerVisible} mode="date" onConfirm={handleConfirmDate} onCancel={hideDatePicker} />
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  filterContainer: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: theme.colors.card, paddingVertical: 10 },
  filterButton: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, backgroundColor: theme.colors.border },
  activeFilter: { backgroundColor: theme.colors.primary },
  filterText: { ...typography.smallStrong, color: theme.colors.text },
  activeFilterText: { color: theme.name === 'light' ? '#fff' : theme.colors.text },
  dateFilterContainer: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', padding: 10, backgroundColor: theme.colors.card, borderTopWidth: 1, borderTopColor: theme.colors.border },
  dateButton: { backgroundColor: theme.colors.border, padding: 10, borderRadius: 5, flex: 1, marginHorizontal: 5 },
  dateButtonText: { ...typography.smallStrong, color: theme.colors.text, textAlign: 'center' },
  clearButton: { backgroundColor: theme.colors.border, padding: 10, borderRadius: 5 },
  clearButtonText: { ...typography.smallStrong, color: theme.colors.text, textAlign: 'center' },
  pickerContainer: { backgroundColor: theme.colors.card, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: theme.colors.border },
  picker: { color: theme.colors.text, height: 50 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: theme.colors.border, paddingHorizontal: 10, paddingVertical: 12, backgroundColor: theme.colors.card },
  headerText: { ...typography.smallStrong, color: theme.colors.text },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tableCell: { ...typography.small, color: theme.colors.text },
  typeCell: { flex: 2, fontWeight: 'bold', textTransform: 'uppercase' },
  messageCell: { flex: 3 },
  timestampCell: { flex: 3 },
  emptyText: { ...typography.small, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 50 },
  container_loader: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader_text: {
    ...typography.body,
    color: theme.colors.text,
    marginTop: 10,
  },
});
