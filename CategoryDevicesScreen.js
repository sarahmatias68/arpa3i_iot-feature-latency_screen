import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView } from 'react-native';
import { useState } from 'react';
import { useAlerts } from './AlertsContext';
import DeviceTypeSelector from './DeviceTypeSelector';

export default function CategoryDevicesScreen({ route, navigation }) {
  const { categoryTitle, categoryIcon, categoryKey } = route.params;
  
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
      return getDevicesByType('gas_fumaca');
    } else if (categoryKey === 'pulseira') {
      return getDevicesByType('pulseira');
    } else if (categoryKey === 'detector') {
      return [...getDevicesByType('barreira'), ...getDevicesByType('microondas'), ...getDevicesByType('detector')];
    }
    return [];
  };

  const categoryDevices = getCategoryDevices();

  const [typeSelectorVisible, setTypeSelectorVisible] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);

  const getBatteryColor = (battery) => {
    if (battery == null) return '#6b7280';
    if (battery <= 2800) return '#ef4444';
    if (battery <= 3600) return '#facc15';
    return '#22c55e';
  };

  const getColorForSensorState = (state) => {
    switch (state) {
      case 'Ambiente Seguro': return '#22c55e';
      case 'Vazamento de Gás': return '#facc15';
      case 'Fumaça Detectada': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const handleRemoveType = async (deviceId) => {
    await updateDeviceType(deviceId, undefined);
  };

  const showTypeSelector = (deviceId) => {
    setSelectedDeviceId(deviceId);
    setTypeSelectorVisible(true);
  };

  const handleTypeSelection = async (typeId) => {
    if (selectedDeviceId) {
      await updateDeviceType(selectedDeviceId, typeId);
    }
    setTypeSelectorVisible(false);
    setSelectedDeviceId(null);
  };

  const renderDeviceCard = (device) => {
    const deviceType = deviceTypes.find(t => t.id === device.deviceType);
    const typeConfig = deviceType || { name: "Sem tipo", color: "#6b7280" };
    const hasType = !!device.deviceType;
    const isSensorDevice = device.deviceId === "SENSOR_GAS_FUMACA";

    const statusText = device.connected ? 'Online' : 'Offline';
    const statusColor = device.connected ? '#22c55e' : '#6b7280';
    
    const isAlertActive = !!device.lastAlertType;
    const alertStyle = 
        device.lastAlertType === 'PANICO' ? styles.cardPanicActive :
        device.lastAlertType === 'QUEDA' ? styles.cardFallActive : null;
    
    const alertStatusText = 
        device.lastAlertType === 'PANICO' ? 'BOTÃO ACIONADO' :
        device.lastAlertType === 'QUEDA' ? 'QUEDA DETECTADA' : statusText;

    const alertStatusColor = 
        device.lastAlertType === 'PANICO' ? '#ef4444' :
        device.lastAlertType === 'QUEDA' ? '#f59e0b' : statusColor;

    return (
      <TouchableOpacity 
        key={device.deviceId} 
        style={[styles.deviceCard, alertStyle]}
        onPress={isAlertActive ? () => acknowledgeAlert(device.deviceId, device.lastAlertType) : undefined}
        activeOpacity={isAlertActive ? 0.7 : 1}
      >
        <View style={styles.deviceHeader}>
          <Text style={styles.deviceTitle} numberOfLines={1} ellipsizeMode="tail">
            {isSensorDevice ? "Sensor de Gás e Fumaça" : device.deviceId}
          </Text>
          {!isSensorDevice && (
            <View style={styles.typeButtonsContainer}>
              <TouchableOpacity 
                style={[
                  styles.typeButton, 
                  { backgroundColor: typeConfig.color },
                  isAlertActive && styles.buttonDisabled
                ]}
                onPress={() => !isAlertActive && showTypeSelector(device.deviceId)}
                disabled={isAlertActive}
              >
                <Text style={styles.typeButtonText}>{typeConfig.name}</Text>
              </TouchableOpacity>
              {hasType && (
                <TouchableOpacity 
                  style={[styles.removeButton, isAlertActive && styles.buttonDisabled]}
                  onPress={() => !isAlertActive && handleRemoveType(device.deviceId)}
                  disabled={isAlertActive}
                >
                  <Text style={styles.removeButtonText}>Remover Tipo</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        {isSensorDevice ? (
          <View style={styles.sensorStateContainer}>
            <Text style={styles.sensorStateLabel}>Estado do Ambiente:</Text>
            <Text style={[styles.sensorStateText, { color: getColorForSensorState(sensorState) }]}>
              {sensorState || 'Indisponível'}
            </Text>
          </View>
        ) : (
          <Text style={[styles.deviceStatus, { color: alertStatusColor }]}>
            {alertStatusText}
          </Text>
        )}
        {device.connected && !isSensorDevice && (
          <View style={styles.deviceInfoBlock}>
            {typeof device.batteryMv === 'number' && (
              <Text style={[styles.deviceInfoText, { color: getBatteryColor(device.batteryMv) }]}>
                Bateria: {device.batteryMv} mV
              </Text>
            )}
            {typeof device.uptimeSec === 'number' && (
              <Text style={styles.deviceInfoText}>
                Tempo ligado: {Math.floor(device.uptimeSec/3600)}h {Math.floor((device.uptimeSec%3600)/60)}m
              </Text>
            )}
            {typeof device.rssiDbm === 'number' && (
              <Text style={styles.deviceInfoText}>WiFi: {device.rssiDbm} dBm</Text>
            )}
            {typeof device.tempCpuC === 'number' && (
              <Text style={styles.deviceInfoText}>CPU: {device.tempCpuC}°C</Text>
            )}
            {typeof device.heapB === 'number' && (
              <Text style={styles.deviceInfoText}>Heap: {device.heapB} B</Text>
            )}
            {device.reconnects !== undefined && (
              <Text style={styles.deviceInfoText}>Reconexões: {device.reconnects}</Text>
            )}
          </View>
        )}
        {isAlertActive && (
          <Text style={[styles.ackHint, { color: alertStatusColor }]}>Toque para marcar como ciente</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerIcon}>{categoryIcon}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#7a8a99',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  headerIcon: {
    fontSize: 60,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginBottom: 5,
  },
  deviceCount: {
    fontSize: 14,
    color: '#f3f4f6',
  },
  deviceCard: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#374151',
  },
  deviceHeader: {
    marginBottom: 12,
  },
  deviceTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f3f4f6',
    marginBottom: 10,
  },
  typeButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  typeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  typeButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  removeButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  removeButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  deviceStatus: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  sensorStateContainer: {
    marginTop: 12,
    padding: 15,
    backgroundColor: '#111827',
    borderRadius: 8,
    alignItems: 'center',
  },
  sensorStateLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 8,
  },
  sensorStateText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  deviceInfoBlock: {
    marginTop: 12,
    gap: 5,
  },
  deviceInfoText: {
    fontSize: 13,
    color: '#d1d5db',
  },
  cardPanicActive: {
    borderWidth: 3,
    borderColor: '#ef4444',
    backgroundColor: '#331111',
  },
  cardFallActive: {
    borderWidth: 3,
    borderColor: '#f59e0b',
    backgroundColor: '#3b2f0a',
  },
  ackHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
});
