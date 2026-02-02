import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { Picker } from '@react-native-picker/picker';
import { getTheme, typography } from './theme';

const API_URL = 'https://painel.arpa3i.me';

// [V49] Lógica de cores baseada na Severidade do Evento
const getEventColor = (severity, theme) => {
  const normSeverity = (severity || '').toUpperCase();
  switch (normSeverity) {
    case 'CRITICAL': return '#ef4444'; // Vermelho (Pânico, Queda)
    case 'WARNING': return '#f59e0b';  // Amarelo (Falha Sensor)
    case 'INFO': return '#3b82f6';     // Azul (Status)
    case 'SYSTEM': return '#6b7280';   // Cinza (Sistema)
    default: return theme.colors.text;
  }
};

export default function LogsScreen({ route, user, themeName = 'dark' }) {

  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!user) {
    return (
      <View style={styles.container_loader}>
        <ActivityIndicator size="large" color={theme.colors.text} />
        <Text style={styles.loader_text}>Carregando dados...</Text>
      </View>
    );
  }

  const [allAlerts, setAllAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filtros
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState('start');

  // [V49] Busca direta na Timeline (Histórico Unificado)
  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/timeline`);
      if (!response.ok) throw new Error('Falha na resposta do servidor.');
      const data = await response.json();
      setAllAlerts(data);
    } catch (error) {
      console.log('Erro timeline:', error);
      setAllAlerts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchAlerts(); }, [fetchAlerts]));

  // [V49] Filtro Inteligente (Native Implementation)
  const filteredAlerts = useMemo(() => {
    return allAlerts.filter(item => {
      // 1. Filtro por Tipo/Conteúdo
      // Como V49 usa "Categories" genéricas, verificamos se a descrição ou a categoria 
      // contém a palavra-chave do filtro (ex: "PANICO").
      if (typeFilter !== 'all') {
        const search = typeFilter.toUpperCase();
        const desc = (item.description || '').toUpperCase();
        const cat = (item.category || '').toUpperCase();
        const sev = (item.severity || '').toUpperCase();

        // Match se a tag estiver na descrição, categoria ou severidade
        const matches = desc.includes(search) || cat === search || sev === search;
        if (!matches) return false;
      }

      // 2. Filtro de Data
      if (startDate || endDate) {
        if (!item.timestamp) return false; // Se não tem campo data, ignora

        // [FIX] Tratamento para datas inválidas (ex: NO_TIME_DATA do servidor)
        if (item.timestamp === "NO_TIME_DATA") {
          // Se o usuário está filtrando por data, decidimos se mostramos ou não.
          // Opção A: Mostrar sempre logs de sistema sem data no topo
          return true;
        }

        const dateStr = item.timestamp.replace(' ', 'T');
        const alertDate = new Date(dateStr);

        if (isNaN(alertDate.getTime())) return true;

        if (startDate && alertDate < startDate) return false;

        // Ajuste para pegar o final do dia no endDate
        if (endDate) {
          const endOfDay = new Date(endDate);
          endOfDay.setHours(23, 59, 59, 999);
          if (alertDate > endOfDay) return false;
        }
      }
      return true;
    });
  }, [allAlerts, typeFilter, startDate, endDate]);

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
      {/* Coluna 1: Categoria/Severidade colorida */}
      <Text style={[styles.tableCell, styles.typeCell, { color: getEventColor(item.severity, theme) }]}>
        {item.category || item.severity}
      </Text>

      {/* Coluna 2: Descrição do Evento */}
      <Text style={[styles.tableCell, styles.messageCell]}>
        {item.source ? `[${item.source}] ` : ''}{item.description}
      </Text>

      {/* Coluna 3: Data com tratamento visual */}
      <Text style={[styles.tableCell, styles.timestampCell]}>
        {item.timestamp === 'NO_TIME_DATA' ? '--:--' : item.timestamp}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>

      <View style={styles.dateFilterContainer}>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('start')}>
          <Text style={styles.dateButtonText}>{startDate ? startDate.toLocaleDateString() : 'Data Início'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateButton} onPress={() => showDatePicker('end')}>
          <Text style={styles.dateButtonText}>{endDate ? endDate.toLocaleDateString() : 'Data Fim'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
          <Text style={styles.clearButtonText}>Limpar</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={typeFilter}
          onValueChange={(itemValue) => setTypeFilter(itemValue)}
          style={styles.picker}
          dropdownIconColor={theme.colors.text}
        >
          <Picker.Item label="Todos os Eventos" value="all" />
          <Picker.Item label="Pânico" value="PANICO" />
          <Picker.Item label="Queda" value="QUEDA" />
          <Picker.Item label="Fumaça" value="FUMACA" />
          <Picker.Item label="Gás" value="GAS" />
          <Picker.Item label="Wi-Fi / Sistema" value="SYSTEM" />
          <Picker.Item label="Críticos (Geral)" value="CRITICAL" />
        </Picker>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={theme.colors.text} style={{ marginTop: 50 }} />
      ) : (
        <>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.typeCell]}>Tipo</Text>
            <Text style={[styles.headerText, styles.messageCell]}>Evento</Text>
            <Text style={[styles.headerText, styles.timestampCell]}>Data</Text>
          </View>
          <FlatList
            data={filteredAlerts}
            renderItem={renderItem}
            keyExtractor={(item) => item.id.toString()}
            refreshControl={
              <RefreshControl refreshing={isLoading} onRefresh={fetchAlerts} tintColor={theme.colors.text} />
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>Nenhum registro encontrado.</Text>
            }
          />
        </>
      )}
      <DateTimePickerModal
        isVisible={isDatePickerVisible}
        mode="date"
        onConfirm={handleConfirmDate}
        onCancel={hideDatePicker}
      />
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  // Removido filterContainer (botões de status antigos)

  dateFilterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 10,
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border
  },
  dateButton: {
    backgroundColor: theme.colors.border,
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginHorizontal: 5
  },
  dateButtonText: {
    ...typography.smallStrong,
    color: theme.colors.text,
    textAlign: 'center'
  },
  clearButton: {
    backgroundColor: theme.colors.border,
    padding: 10,
    borderRadius: 5
  },
  clearButtonText: {
    ...typography.smallStrong,
    color: theme.colors.text,
    textAlign: 'center'
  },
  pickerContainer: {
    backgroundColor: theme.colors.card,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border
  },
  picker: {
    color: theme.colors.text,
    height: 50
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: theme.colors.card
  },
  headerText: {
    ...typography.smallStrong,
    color: theme.colors.text
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border
  },
  tableCell: {
    ...typography.small,
    color: theme.colors.text
  },
  typeCell: {
    flex: 2,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    fontSize: 10
  },
  messageCell: { flex: 4, paddingRight: 5 }, // Ajustado flex para dar mais espaço ao texto
  timestampCell: { flex: 2.5, fontSize: 10 },
  emptyText: {
    ...typography.small,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 50
  },
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