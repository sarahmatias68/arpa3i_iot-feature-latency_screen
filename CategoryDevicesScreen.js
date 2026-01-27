import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from './AlertsContext';
import DeviceTypeSelector from './DeviceTypeSelector';
import { getTheme, typography } from './theme';

export default function CategoryDevicesScreen({ route, navigation, themeName = 'dark' }) {
  const { categoryTitle, categoryIcon, categoryKey, focusDeviceId } = route.params || {};
  
  const {
    deviceTypes,
    updateDeviceType,
    acknowledgeAlert,
    sensorState,
    getDevicesByType,
  } = useAlerts();

  // Busca os dispositivos em tempo real do contexto
  const getCategoryDevices = () => {
    if (categoryKey === 'sensores') {
      return getDevicesByType('gas_fumaca').filter(d => d.deviceId !== 'SENSOR_GAS_FUMACA');
    } else if (categoryKey === 'pulseira') {
      return getDevicesByType('pulseira');
    } else if (categoryKey === 'detector') {
      return [...getDevicesByType('barreira'), ...getDevicesByType('microondas'), ...getDevicesByType('detector')];
    } else if (categoryKey === 'automacao') {
      return getDevicesByType('automacao');
    } else if (categoryKey === 'server' || categoryTitle === 'Servidor') {
      // Garante que o servidor apareça se a categoria for servidor
      return getDevicesByType('server');
    }
    return [];
  };

  const categoryDevices = getCategoryDevices();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!focusDeviceId || !scrollRef.current) return;
    const idx = categoryDevices.findIndex(d => d.deviceId === focusDeviceId);
    if (idx >= 0) {
      scrollRef.current.scrollTo({ y: Math.max(0, idx * 140), animated: true });
    }
  }, [focusDeviceId, categoryDevices]);

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const getBatteryColor = (battery) => {
    if (battery == null) return theme.colors.muted;
    if (battery <= 2800) return theme.colors.danger;
    if (battery <= 3600) return theme.colors.warning;
    return theme.colors.success;
  };

  const getColorForSensorState = (state) => {
    switch (state) {
      case 'Ambiente Seguro': return theme.colors.success;
      case 'Vazamento de Gás': return theme.colors.warning;
      case 'Fumaça Detectada': return theme.colors.danger;
      default: return theme.colors.muted;
    }
  };

  const formatDuration = (ms) => {
    if (!ms || ms < 0) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const handleRemoveType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const showTypeSelector = (deviceId) => {
    setSelectedDeviceId(deviceId);
    setTypeSelectorVisible(true);
  };

  const handleTypeSelection = async (typeId) => {
    if (selectedDeviceId) await updateDeviceType(selectedDeviceId, typeId);
    setTypeSelectorVisible(false);
    setSelectedDeviceId(null);
  };

  const renderDeviceCard = (device) => {
    const deviceType = deviceTypes.find(t => t.id === device.deviceType);
    const typeConfig = deviceType || { name: "Sem tipo", color: theme.colors.muted };
    const hasType = !!device.deviceType;
    const isSensorDevice = device.deviceId === "SENSOR_GAS_FUMACA";

    const statusText = device.connected ? 'Online' : 'Offline';
    const statusColor = device.connected ? theme.colors.success : theme.colors.muted;
    
    // Cálculo seguro do tempo offline
    const offlineDuration = !device.connected && device.lastSeen
      ? Math.max(0, Date.now() - device.lastSeen)
      : 0;
    
    const isAlertActive = !!device.lastAlertType;
    const alertStyle =  
        device.lastAlertType === 'PANICO' ? styles.cardPanicActive :
        device.lastAlertType === 'QUEDA' ? styles.cardFallActive : null;
    
    const alertStatusText = 
        device.lastAlertType === 'PANICO' ? 'BOTÃO ACIONADO' :
        device.lastAlertType === 'QUEDA' ? 'QUEDA DETECTADA' : statusText;

    const alertStatusColor = 
        device.lastAlertType === 'PANICO' ? theme.colors.danger :
        device.lastAlertType === 'QUEDA' ? theme.colors.warning : statusColor;

    return (
      <TouchableOpacity 
        key={device.deviceId} 
        style={[styles.deviceCard, alertStyle]}
        onPress={isAlertActive ? () => acknowledgeAlert(device.deviceId, device.lastAlertType) : undefined}
        activeOpacity={0.8}
      >
        <View style={styles.deviceHeader}>
          <Text style={styles.deviceTitle} numberOfLines={1} ellipsizeMode="tail">
            {isSensorDevice ? "Sensor de Gás e Fumaça" : device.deviceId}
          </Text>
        </View>
        <View style={styles.mainContent}>
          <View style={styles.infoColumn}>
            {isSensorDevice ? (
              <View style={styles.sensorStateContainer}>
                <Text style={styles.sensorStateLabel}>Estado do Ambiente:</Text>
                <Text style={[styles.sensorStateText, { color: getColorForSensorState(sensorState) }]}>
                  {sensorState || 'Indisponível'}
                </Text>
                {typeof device.lastSeen === 'number' && device.lastSeen > 0 ? (
                  <Text style={[styles.sensorStateLabel, { marginTop: 8 }]}>
                     Atualizado há {Math.max(0, Math.floor((Date.now() - device.lastSeen)/1000))}s
                  </Text>
                ) : null}
              </View>
            ) : (
              <>
                <Text style={[styles.deviceStatus, { color: alertStatusColor }]}>
                  {alertStatusText}
                </Text>

                {/* BLINDAGEM: Usamos ternário (? :) para garantir que ou renderiza <Text> ou null */}
                {!device.connected && offlineDuration > 0 ? (
                  <Text style={styles.offlineTimer}>
                    Offline há {formatDuration(offlineDuration)}
                  </Text>
                ) : null}

                {!isSensorDevice && isAlertActive && !!device.lastAlertAt ? (
                  <Text style={styles.deviceInfoText}>
                    Notificado: {new Date(device.lastAlertAt).toLocaleString()}
                  </Text>
                ) : null}

                {device.connected && !isSensorDevice ? (
                  <View style={styles.deviceInfoBlock}>
                    {typeof device.batteryMv === 'number' ? (
                      <Text style={[styles.deviceInfoText, { color: getBatteryColor(device.batteryMv) }]}>
                        Bateria: {device.batteryMv} mV
                      </Text>
                    ) : null}

                    {typeof device.uptimeSec === 'number' ? (
                      <Text style={styles.deviceInfoText}>
                        Tempo ligado: {Math.floor(device.uptimeSec/3600)}h {Math.floor((device.uptimeSec%3600)/60)}m
                      </Text>
                    ) : null}

                    {typeof device.rssiDbm === 'number' ? (
                      <Text style={styles.deviceInfoText}>WiFi: {device.rssiDbm} dBm</Text>
                    ) : null}

                    {typeof device.tempCpuC === 'number' ? (
                      <Text style={styles.deviceInfoText}>CPU: {device.tempCpuC}°C</Text>
                    ) : null}

                    {typeof device.heapB === 'number' ? (
                      <Text style={styles.deviceInfoText}>Heap: {device.heapB} B</Text>
                    ) : null}

                    {typeof device.reconnects === 'number' ? (
                      <Text style={styles.deviceInfoText}>Reconexões: {device.reconnects}</Text>
                    ) : null}

                    {typeof device.lastSeen === 'number' && device.lastSeen > 0 ? (
                      <Text style={styles.deviceInfoText}>
                        Atualizado há {Math.max(0, Math.floor((Date.now() - device.lastSeen)/1000))}s
                      </Text>
                    ) : null}
                    
                    {device.ip ? (
                      <Text style={styles.deviceInfoText}>IP: {device.ip}</Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </View>
          
          {!isSensorDevice ? (
            <View style={styles.actionsColumn}>
              <TouchableOpacity 
                style={[styles.typeButton, { backgroundColor: typeConfig.color }, isAlertActive && styles.buttonDisabled]}
                onPress={() => !isAlertActive && showTypeSelector(device.deviceId)}
                disabled={isAlertActive}
              >
                <Text style={styles.typeButtonText}>{typeConfig.name}</Text>
              </TouchableOpacity>
              
              {hasType ? (
                <TouchableOpacity 
                  style={[styles.removeButton, isAlertActive && styles.buttonDisabled]}
                  onPress={() => !isAlertActive && handleRemoveType(device.deviceId)}
                  disabled={isAlertActive}
                >
                  <Text style={styles.removeButtonText}>Limpar Tipo</Text>
                </TouchableOpacity>
              ) : null}
              
              <TouchableOpacity 
                style={[styles.eventsButton, isAlertActive && styles.buttonDisabled]}
                onPress={() => navigation.navigate('DeviceEvents', { deviceId: device.deviceId })}
                disabled={isAlertActive}
              >
                <Text style={styles.eventsButtonText}>Eventos</Text>
              </TouchableOpacity>
            </View>
          ) : null}

        </View>
        
        {isAlertActive ? (
          <Text style={[styles.ackHint, { color: alertStatusColor }]}>Toque para marcar como ciente</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={theme.name === 'light' ? 'dark-content' : 'light-content'} />
      <ScrollView 
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Ionicons name={categoryIcon || 'apps-outline'} size={64} color={theme.colors.primary} style={styles.headerIcon} />
          <Text style={styles.headerTitle}>{categoryTitle}</Text>
          <Text style={styles.deviceCount}>{categoryDevices.length} dispositivo(s)</Text>
        </View>

        {categoryDevices.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>Nenhum dispositivo nesta categoria</Text>
          </View>
        ) : (
          categoryDevices.map(device => renderDeviceCard(device))
        )}
      </ScrollView>

      <DeviceTypeSelector
        visible={typeSelectorVisible}
        onClose={() => setTypeSelectorVisible(false)}
        onSelectType={handleTypeSelection}
        deviceTypes={deviceTypes}
        deviceId={selectedDeviceId}
      />
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 30, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  headerIcon: { fontSize: 60, marginBottom: 10 },
  headerTitle: { ...typography.h1, color: theme.colors.text, marginBottom: 5, textAlign: 'center' },
  deviceCount: { ...typography.small, color: theme.colors.muted },
  deviceCard: { backgroundColor: theme.colors.card, borderRadius: 12, padding: 16, marginBottom: 15, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'flex-end' },
  deviceHeader: { marginBottom: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.border_card },
  deviceTitle: { ...typography.h3, color: theme.colors.text, marginBottom: 6, textAlign: 'center', alignItems: 'center', flexShrink: 1 },
  actionsColumn: { gap: 8 },
  typeButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.colors.primary, alignItems: 'center' },
  typeButtonText: { color: theme.name === 'light' ? '#ffffff' : theme.colors.text, fontSize: 13, fontWeight: 'bold' },
  removeButton: { backgroundColor: theme.colors.danger, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  removeButtonText: { color: '#ffffff', fontSize: 13, fontWeight: 'bold' },
  eventsButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.primary, backgroundColor: theme.colors.card, alignItems: 'center' },
  eventsButtonText: { color: theme.colors.primary, fontSize: 13, fontWeight: 'bold' },
  buttonDisabled: { opacity: 0.5 },
  deviceStatus: { marginTop: 2, ...typography.smallStrong, marginBottom: 5 },
  sensorStateContainer: { marginTop: 12, padding: 15, backgroundColor: theme.name === 'light' ? '#e5e7eb' : '#111827', borderRadius: 8, alignItems: 'center' },
  sensorStateLabel: { ...typography.small, color: theme.colors.muted, marginBottom: 8 },
  sensorStateText: { ...typography.h2, color: theme.colors.text },
  deviceInfoBlock: { marginTop: 12, gap: 5 },
  deviceInfoText: { ...typography.small, color: theme.colors.muted, fontWeight: 'bold' },
  offlineTimer: { marginTop: 4, ...typography.smallStrong, color: theme.colors.muted },
  cardPanicActive: { borderWidth: 2, borderColor: theme.colors.danger, backgroundColor: theme.name === 'light' ? '#fee2e2' : '#331111' },
  cardFallActive: { borderWidth: 2, borderColor: theme.colors.warning, backgroundColor: theme.name === 'light' ? '#fef3c7' : '#3b2f0a' },
  ackHint: { marginTop: 8, ...typography.smallStrong },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyStateText: { ...typography.body, color: theme.colors.muted, textAlign: 'center' },
  mainContent: { flexDirection: 'row', alignItems: 'center' },
  infoColumn: { flex: 1 },
});