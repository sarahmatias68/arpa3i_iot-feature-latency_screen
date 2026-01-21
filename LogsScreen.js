import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Alert, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTheme, typography } from './theme';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { Picker } from '@react-native-picker/picker';

// IP atualizado para o Servidor Central (v48) na porta 86
const API_URL = 'http://painel.arpa3i.me';

const getSeverityColor = (severity, theme) => {
  switch (severity) {
    case 'CRITICAL': return '#ef4444'; // Vermelho
    case 'WARNING': return '#f97316';  // Laranja
    case 'INFO': return '#3b82f6';     // Azul
    default: return theme.colors.text;
  }
};

export default function LogsScreen({ route, user, themeName = 'dark' }) {
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [timeline, setTimeline] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filtros adaptados para a nova arquitetura
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState('start');

  const fetchTimeline = useCallback(async () => {
    setIsLoading(true);
    try {
      // MUDANÇA CRÍTICA: Rota /timeline em vez de /alerts
      const response = await fetch(`${API_URL}/timeline`);
      if (!response.ok) throw new Error('Falha na resposta do servidor.');
      const data = await response.json();
      setTimeline(data);
    } catch (error) {
      console.warn('Erro ao buscar timeline:', error);
      setTimeline([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchTimeline(); }, [fetchTimeline]));

  // Lógica de filtragem baseada na Timeline v48
  const filteredLogs = useMemo(() => {
    return timeline.filter(item => {
      const categoryMatch = categoryFilter === 'all' || item.category === categoryFilter;
      const severityMatch = severityFilter === 'all' || item.severity === severityFilter;
      
      if (!categoryMatch || !severityMatch) return false;

      if (startDate || endDate) {
        // O ESP32 envia: YYYY-MM-DD HH:MM:SS
        const logDate = new Date(item.timestamp.replace(' ', 'T'));
        if (startDate && logDate < startDate) return false;
        if (endDate) {
          const endOfDay = new Date(endDate);
          endOfDay.setHours(23, 59, 59);
          if (logDate > endOfDay) return false;
        }
      }
      return true;
    });
  }, [timeline, categoryFilter, severityFilter, startDate, endDate]);

  const showDatePicker = (mode) => { setDatePickerMode(mode); setDatePickerVisibility(true); };
  const hideDatePicker = () => setDatePickerVisibility(false);
  const handleConfirmDate = (date) => {
    if (datePickerMode === 'start') setStartDate(date);
    else setEndDate(date);
    hideDatePicker();
  };

  const clearFilters = () => { setStartDate(null); setEndDate(null); setCategoryFilter('all'); setSeverityFilter('all'); };

  const renderItem = ({ item }) => (
    <View style={styles.tableRow}>
      <View style={styles.typeCol}>
        <Text style={[styles.categoryBadge, { color: getSeverityColor(item.severity, theme) }]}>
          {item.category}
        </Text>
        <Text style={styles.sourceText}>{item.source}</Text>
      </View>
      <View style={styles.messageCol}>
        <Text style={styles.messageText}>{item.description}</Text>
      </View>
      <View style={styles.timeCol}>
        <Text style={styles.timeText}>{item.timestamp.split(' ')[1]}</Text>
        <Text style={styles.dateText}>{item.timestamp.split(' ')[0]}</Text>
      </View>
    </View>
  );

  if (!user) {
    return (
      <View style={styles.container_loader}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loader_text}>Autenticando...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filtros de Categoria */}
      <View style={styles.filterContainer}>
        <TouchableOpacity style={[styles.filterButton, categoryFilter === 'ALERT' && styles.activeFilter]} onPress={() => setCategoryFilter('ALERT')}>
          <Text style={[styles.filterText, categoryFilter === 'ALERT' && styles.activeFilterText]}>Alertas</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterButton, categoryFilter === 'SYSTEM' && styles.activeFilter]} onPress={() => setCategoryFilter('SYSTEM')}>
          <Text style={[styles.filterText, categoryFilter === 'SYSTEM' && styles.activeFilterText]}>Sistema</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterButton, categoryFilter === 'all' && styles.activeFilter]} onPress={() => setCategoryFilter('all')}>
          <Text style={[styles.filterText, categoryFilter === 'all' && styles.activeFilterText]}>Todos</Text>
        </TouchableOpacity>
      </View>

      {/* Datas */}
      <View style={styles.dateFilterContainer}>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('start')}>
          <Text style={styles.dateButtonText}>{startDate ? startDate.toLocaleDateString() : 'Início'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('end')}>
          <Text style={styles.dateButtonText}>{endDate ? endDate.toLocaleDateString() : 'Fim'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
          <Ionicons name="trash-outline" size={18} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      {/* Seletor de Gravidade */}
      <View style={styles.pickerContainer}>
        <Picker 
          selectedValue={severityFilter} 
          onValueChange={(v) => setSeverityFilter(v)} 
          style={styles.picker} 
          dropdownIconColor={theme.colors.text}
        >
          <Picker.Item label="Todas as Gravidades" value="all" />
          <Picker.Item label="Crítico (Vermelho)" value="CRITICAL" />
          <Picker.Item label="Aviso (Laranja)" value="WARNING" />
          <Picker.Item label="Informação (Azul)" value="INFO" />
        </Picker>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 50 }} />
      ) : (
        <FlatList 
          data={filteredLogs} 
          renderItem={renderItem} 
          keyExtractor={(item) => item.id.toString()} 
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchTimeline} />} 
          ListEmptyComponent={<Text style={styles.emptyText}>Nenhum registro encontrado na Timeline.</Text>} 
        />
      )}
      
      <DateTimePickerModal isVisible={isDatePickerVisible} mode="date" onConfirm={handleConfirmDate} onCancel={hideDatePicker} />
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  container_loader: { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loader_text: { ...typography.body, color: theme.colors.text, marginTop: 10 },
  
  filterContainer: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: theme.colors.card, paddingVertical: 12 },
  filterButton: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 15, backgroundColor: theme.colors.border },
  activeFilter: { backgroundColor: theme.colors.primary },
  filterText: { fontSize: 12, fontWeight: 'bold', color: theme.colors.text },
  activeFilterText: { color: '#fff' },

  dateFilterContainer: { flexDirection: 'row', padding: 10, backgroundColor: theme.colors.card, gap: 10 },
  dateButton: { backgroundColor: theme.colors.border, padding: 8, borderRadius: 6, flex: 1, alignItems: 'center' },
  dateButtonText: { fontSize: 12, color: theme.colors.text },
  clearButton: { backgroundColor: theme.colors.border, padding: 8, borderRadius: 6, justifyContent: 'center' },

  pickerContainer: { backgroundColor: theme.colors.card, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  picker: { color: theme.colors.text, height: 50 },

  tableRow: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderBottomColor: theme.colors.border, alignItems: 'center' },
  typeCol: { flex: 2 },
  messageCol: { flex: 4, paddingHorizontal: 10 },
  timeCol: { flex: 2, alignItems: 'flex-end' },

  categoryBadge: { fontSize: 10, fontWeight: '900', marginBottom: 2 },
  sourceText: { fontSize: 11, color: theme.colors.muted, fontWeight: 'bold' },
  messageText: { fontSize: 13, color: theme.colors.text, lineHeight: 18 },
  timeText: { fontSize: 12, fontWeight: 'bold', color: theme.colors.text },
  dateText: { fontSize: 10, color: theme.colors.muted },
  
  emptyText: { textAlign: 'center', marginTop: 50, color: theme.colors.muted, fontSize: 14 }
});